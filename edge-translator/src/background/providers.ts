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
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ProviderCallError('invalid_response', '模型返回不是合法 JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new ProviderCallError('invalid_response', '模型返回不是 JSON 数组');
  }

  return parsed.map((item, index) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      id: typeof obj.id === 'string' ? obj.id : String(index),
      text: typeof obj.text === 'string' ? obj.text : '',
    };
  });
}
