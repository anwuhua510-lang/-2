import type {
  GlossaryEntry,
  ProviderConfig,
  SegmentTranslation,
  SourceLanguage,
  TargetLanguage,
  TranslationErrorKind,
  TranslationSegment,
} from '../shared/types';
import { DEFAULT_ENDPOINTS } from '../shared/types';
import { buildPrompt, type BuiltPrompt } from './prompt';

const REQUEST_TIMEOUT_MS = 60_000;

export interface ProviderResult {
  segments: SegmentTranslation[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export class ProviderCallError extends Error {
  readonly kind: TranslationErrorKind;

  constructor(kind: TranslationErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function callProvider(
  provider: ProviderConfig,
  segments: TranslationSegment[],
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
  glossary: GlossaryEntry[],
  signal?: AbortSignal,
): Promise<ProviderResult> {
  const prompt = buildPrompt({ segments, sourceLanguage, targetLanguage, glossary });
  if (provider.kind === 'gemini') return callGemini(provider, prompt, signal);
  return callOpenAICompatible(provider, prompt, signal);
}

async function callGemini(
  provider: ProviderConfig,
  prompt: BuiltPrompt,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  const baseUrl = (provider.baseUrl ?? DEFAULT_ENDPOINTS.gemini).replace(/\/+$/, '');
  const modelPath = `models/${encodeURIComponent(provider.model)}:generateContent`;
  const body = JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });
  const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

  // 优先用 ?key= 查询参数；若返回 401（部分新格式 AQ. key 的兼容问题），
  // 改用 x-goog-api-key 请求头重试一次。
  let response = await fetchWithTimeout(
    `${baseUrl}/${modelPath}?key=${encodeURIComponent(provider.apiKey)}`,
    { method: 'POST', headers: jsonHeaders, body, signal },
  );
  if (response.status === 401) {
    response = await fetchWithTimeout(`${baseUrl}/${modelPath}`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-goog-api-key': provider.apiKey },
      body,
      signal,
    });
  }

  if (!response.ok) throw await classifyHttpError(response);

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text =
    json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  const usage = json.usageMetadata
    ? {
        inputTokens: json.usageMetadata.promptTokenCount,
        outputTokens: json.usageMetadata.candidatesTokenCount,
      }
    : undefined;
  return { segments: parseSegments(text), usage };
}

async function callOpenAICompatible(
  provider: ProviderConfig,
  prompt: BuiltPrompt,
  signal?: AbortSignal,
): Promise<ProviderResult> {
  const baseUrl = (provider.baseUrl ?? DEFAULT_ENDPOINTS['openai-compatible']).replace(
    /\/+$/,
    '',
  );
  const url = `${baseUrl}/chat/completions`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
    signal,
  });

  if (!response.ok) throw await classifyHttpError(response);

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? '';
  const usage = json.usage
    ? {
        inputTokens: json.usage.prompt_tokens,
        outputTokens: json.usage.completion_tokens,
      }
    : undefined;
  return { segments: parseSegments(text), usage };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const external = init.signal;

  const onExternalAbort = () => controller.abort();
  if (external?.aborted) controller.abort();
  else external?.addEventListener('abort', onExternalAbort);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (external?.aborted) {
      throw new ProviderCallError('cancelled', '任务已取消');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderCallError('timeout', `请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProviderCallError('network', `网络错误：${detail}`);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

async function classifyHttpError(response: Response): Promise<ProviderCallError> {
  const status = response.status;
  let body = '';
  try {
    body = await response.text();
  } catch {
    // 忽略响应体读取失败
  }
  const lower = body.toLowerCase();
  const snippet = body.slice(0, 200);

  if (status === 429) {
    if (
      lower.includes('tokens per day') ||
      lower.includes('tokens/day') ||
      lower.includes('tpd') ||
      lower.includes('quota')
    ) {
      return new ProviderCallError(
        'quota_exhausted',
        `今日免费额度已用尽：${snippet}`,
      );
    }
    return new ProviderCallError('rate_limited', `限流（429）：${snippet}`);
  }
  if (status === 401) {
    return new ProviderCallError('auth_failed', 'API key 无效（401）');
  }
  if (status === 403) {
    if (
      lower.includes('quota') ||
      lower.includes('insufficient') ||
      lower.includes('exhausted') ||
      lower.includes('rate limit')
    ) {
      return new ProviderCallError('quota_exhausted', `额度用尽（403）：${snippet}`);
    }
    return new ProviderCallError('auth_failed', `访问被拒绝（403）：${snippet}`);
  }
  if (
    status === 404 &&
    (lower.includes('no longer available') ||
      lower.includes('model not found') ||
      lower.includes('not found'))
  ) {
    return new ProviderCallError(
      'config_error',
      '模型不存在或已下线，请到设置页把模型改为当前可用版本（Gemini 请用 gemini-3.6-flash）',
    );
  }
  if (status >= 500) {
    return new ProviderCallError('server_error', `服务端错误（${status}）`);
  }
  return new ProviderCallError('invalid_response', `HTTP ${status}：${snippet}`);
}

function parseSegments(text: string): SegmentTranslation[] {
  const parsed = parseJsonLoose(text);
  if (parsed === undefined) {
    throw new ProviderCallError(
      'invalid_response',
      `模型返回不是合法 JSON（原始内容：${snippet(text, 120)}）`,
    );
  }

  const list = unwrapList(parsed);
  if (list === undefined) {
    throw new ProviderCallError(
      'invalid_response',
      `模型返回不是 JSON 数组（原始内容：${snippet(text, 120)}）`,
    );
  }

  return list.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      id: typeof obj.id === 'string' ? obj.id : String(index),
      text: typeof obj.text === 'string' ? obj.text : '',
    };
  });
}

function snippet(text: string, length: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > length ? compact.slice(0, length) + '…' : compact;
}

/**
 * 宽松解析：先按原样 JSON.parse；失败则从文本中提取第一个完整的
 * JSON 对象或数组（容忍模型在 JSON 前后附加说明文字）。
 */
function parseJsonLoose(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  if (!cleaned) return undefined;
  try {
    return JSON.parse(cleaned);
  } catch {
    return extractJsonValue(cleaned);
  }
}

function extractJsonValue(text: string): unknown {
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  for (const start of starts) {
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === open) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * 接受数组，或常见的对象包装（translations/segments/result/data/items），
 * 以及单个 {id,text} 对象（视为单元素数组）。
 */
function unwrapList(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && typeof record.text === 'string') {
      return [record];
    }
    for (const key of ['translations', 'segments', 'result', 'data', 'items']) {
      if (Array.isArray(record[key])) return record[key];
    }
  }
  return undefined;
}
