import type {
  ExtensionSettings,
  ProviderConfig,
  RuntimeMessage,
  SegmentTranslation,
  TranslationError,
  TranslationErrorKind,
  TranslationRequest,
  TranslationSegment,
} from '../shared/types';
import { callProvider, ProviderCallError } from './providers';
import { getSettings, saveSettings } from './settings';

const activeRuns = new Map<number, AbortController>();

interface RuntimeState {
  providerIndex: number;
  lastUsedProvider?: ProviderConfig;
}

export function sendToTab(tabId: number, message: RuntimeMessage): void {
  chrome.tabs
    .sendMessage(tabId, message)
    .catch(() => {
      // 标签页已关闭或 content script 未注入：忽略
    });
}

export async function handleTranslatePage(
  request: TranslationRequest,
  tabId: number,
): Promise<void> {
  activeRuns.get(tabId)?.abort();
  const controller = new AbortController();
  activeRuns.set(tabId, controller);

  const settings = await getSettings();
  let providers = settings.providers.filter(
    (provider) => provider.enabled && provider.apiKey.trim() !== '',
  );

  if (request.providerId) {
    providers = [
      ...providers.filter((provider) => provider.id === request.providerId),
      ...providers.filter((provider) => provider.id !== request.providerId),
    ];
  }

  if (providers.length === 0) {
    sendToTab(tabId, {
      type: 'TRANSLATE_FAILED',
      error: {
        kind: 'config_error',
        message: '尚未配置 API key，请打开扩展设置页添加。',
        retryable: false,
      },
    });
    activeRuns.delete(tabId);
    return;
  }

  const chunks = chunkSegments(
    request.segments,
    settings.maxCharsPerRequest,
    settings.maxSegmentsPerRequest,
  );
  const results: SegmentTranslation[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const runtime: RuntimeState = { providerIndex: 0 };

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    if (controller.signal.aborted) {
      activeRuns.delete(tabId);
      return;
    }

    sendToTab(tabId, {
      type: 'TRANSLATE_PROGRESS',
      done: chunkIndex,
      total: chunks.length,
      providerName:
        providers[runtime.providerIndex % providers.length].name,
    });

    try {
      const translated = await translateChunkRecursive({
        segments: chunks[chunkIndex],
        providers,
        settings,
        request,
        controller,
        runtime,
        depth: 0,
      });
      results.push(...translated.segments);
      usage.inputTokens += translated.usage?.inputTokens ?? 0;
      usage.outputTokens += translated.usage?.outputTokens ?? 0;
      sendToTab(tabId, {
        type: 'TRANSLATE_CHUNK',
        segments: translated.segments,
      });
    } catch (error) {
      sendToTab(tabId, {
        type: 'TRANSLATE_FAILED',
        error: toTranslationError(error, settings.autoRetry),
      });
      activeRuns.delete(tabId);
      return;
    }
  }

  if (!controller.signal.aborted) {
    sendToTab(tabId, {
      type: 'TRANSLATE_DONE',
      result: {
        providerId: runtime.lastUsedProvider?.id ?? '',
        segments: results,
        usage,
      },
    });
  }
  activeRuns.delete(tabId);
}

interface ChunkParams {
  segments: TranslationSegment[];
  providers: ProviderConfig[];
  settings: ExtensionSettings;
  request: TranslationRequest;
  controller: AbortController;
  runtime: RuntimeState;
  depth: number;
}

interface ChunkResult {
  segments: SegmentTranslation[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * 递归翻译一个块：优先整块发送；若模型返回不完整（截断/漏段），
 * 自动拆成两半分别重试，最多拆两层，保证长列表也能完整翻译。
 */
async function translateChunkRecursive(
  params: ChunkParams,
): Promise<ChunkResult> {
  try {
    return await translateChunkWithRetries(params);
  } catch (error) {
    const isIncomplete =
      error instanceof ProviderCallError &&
      error.kind === 'invalid_response' &&
      params.segments.length > 1 &&
      params.depth < 2;
    if (!isIncomplete) throw error;

    const mid = Math.ceil(params.segments.length / 2);
    const left = await translateChunkRecursive({
      ...params,
      segments: params.segments.slice(0, mid),
      depth: params.depth + 1,
    });
    const right = await translateChunkRecursive({
      ...params,
      segments: params.segments.slice(mid),
      depth: params.depth + 1,
    });
    return {
      segments: [...left.segments, ...right.segments],
      usage: {
        inputTokens:
          (left.usage?.inputTokens ?? 0) + (right.usage?.inputTokens ?? 0),
        outputTokens:
          (left.usage?.outputTokens ?? 0) + (right.usage?.outputTokens ?? 0),
      },
    };
  }
}

async function translateChunkWithRetries(
  params: ChunkParams,
): Promise<ChunkResult> {
  const { segments, providers, settings, request, controller, runtime } = params;
  const attemptBudget = settings.maxRetries + providers.length;
  let attempts = 0;
  let lastError: ProviderCallError = new ProviderCallError(
    'network',
    '未知错误',
  );

  while (attempts < attemptBudget) {
    const provider = providers[runtime.providerIndex % providers.length];
    attempts += 1;
    try {
      const result = await callProvider(
        provider,
        segments,
        request.sourceLanguage,
        request.targetLanguage,
        request.glossary,
        controller.signal,
      );
      if (!isCompleteChunk(segments, result.segments)) {
        throw new ProviderCallError(
          'invalid_response',
          '模型返回的段落数量不完整',
        );
      }
      runtime.lastUsedProvider = provider;
      return result;
    } catch (error) {
      lastError =
        error instanceof ProviderCallError
          ? error
          : new ProviderCallError('invalid_response', String(error));

      if (lastError.kind === 'cancelled') throw lastError;

      if (
        lastError.kind === 'quota_exhausted' ||
        lastError.kind === 'auth_failed'
      ) {
        runtime.providerIndex = (runtime.providerIndex + 1) % providers.length;
        await rotateProviderToEnd(settings, provider);
        continue;
      }

      if (lastError.kind === 'rate_limited') {
        runtime.providerIndex = (runtime.providerIndex + 1) % providers.length;
        await sleep(1000);
        continue;
      }

      if (!settings.autoRetry) throw lastError;
      await sleep(backoffMs(attempts));
    }
  }

  throw lastError;
}

export function chunkSegments(
  segments: TranslationSegment[],
  maxChars: number,
  maxSegments: number,
): TranslationSegment[][] {
  const chunks: TranslationSegment[][] = [];
  let current: TranslationSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const length = segment.text.length;
    if (
      current.length > 0 &&
      (currentChars + length > maxChars || current.length >= maxSegments)
    ) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(segment);
    currentChars += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function isCompleteChunk(
  input: TranslationSegment[],
  output: SegmentTranslation[],
): boolean {
  if (output.length !== input.length) return false;
  const ids = new Set(input.map((segment) => segment.id));
  return output.every((segment) => ids.has(segment.id));
}

function toTranslationError(
  error: unknown,
  autoRetry: boolean,
): TranslationError {
  const providerError =
    error instanceof ProviderCallError
      ? error
      : new ProviderCallError('invalid_response', String(error));
  return {
    kind: providerError.kind,
    message: providerError.message,
    retryable: isRetryable(providerError.kind, autoRetry),
  };
}

function isRetryable(kind: TranslationErrorKind, autoRetry: boolean): boolean {
  if (!autoRetry) return false;
  return (
    kind === 'network' ||
    kind === 'timeout' ||
    kind === 'server_error' ||
    kind === 'rate_limited' ||
    kind === 'invalid_response'
  );
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rotateProviderToEnd(
  settings: ExtensionSettings,
  provider: ProviderConfig,
): Promise<void> {
  const list = [...settings.providers];
  const index = list.findIndex((item) => item.id === provider.id);
  if (index === -1) return;
  list.splice(index, 1);
  list.push(provider);
  settings.providers = list;
  await saveSettings(settings);
  chrome.runtime
    .sendMessage({
      type: 'SETTINGS_UPDATED',
      settings,
    } satisfies RuntimeMessage)
    .catch(() => {
      // 没有接收方时忽略
    });
}
