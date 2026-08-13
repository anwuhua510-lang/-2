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

  const chunks = chunkSegments(request.segments, settings.maxCharsPerRequest);
  const results: SegmentTranslation[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let providerIndex = 0;
  let lastUsedProvider: ProviderConfig | undefined;

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    if (controller.signal.aborted) {
      activeRuns.delete(tabId);
      return;
    }

    sendToTab(tabId, {
      type: 'TRANSLATE_PROGRESS',
      done: chunkIndex,
      total: chunks.length,
      providerName: providers[providerIndex % providers.length].name,
    });

    let ok = false;
    let attempts = 0;
    let lastError: TranslationError = {
      kind: 'network',
      message: '未知错误',
      retryable: false,
    };
    const attemptBudget = settings.maxRetries + providers.length;

    while (attempts < attemptBudget && !ok) {
      const provider = providers[providerIndex % providers.length];
      attempts += 1;
      try {
        const result = await callProvider(
          provider,
          chunks[chunkIndex],
          request.sourceLanguage,
          request.targetLanguage,
          request.glossary,
          controller.signal,
        );
        if (!isCompleteChunk(chunks[chunkIndex], result.segments)) {
          throw new ProviderCallError(
            'invalid_response',
            '模型返回的段落数量不完整',
          );
        }
        results.push(...result.segments);
        lastUsedProvider = provider;
        usage.inputTokens += result.usage?.inputTokens ?? 0;
        usage.outputTokens += result.usage?.outputTokens ?? 0;
        sendToTab(tabId, {
          type: 'TRANSLATE_CHUNK',
          segments: result.segments,
        });
        ok = true;
      } catch (error) {
        const providerError =
          error instanceof ProviderCallError
            ? error
            : new ProviderCallError('invalid_response', String(error));
        lastError = {
          kind: providerError.kind,
          message: providerError.message,
          retryable: isRetryable(providerError.kind, settings.autoRetry),
        };

        if (providerError.kind === 'cancelled') {
          activeRuns.delete(tabId);
          return;
        }

        if (
          providerError.kind === 'quota_exhausted' ||
          providerError.kind === 'auth_failed'
        ) {
          providerIndex = (providerIndex + 1) % providers.length;
          await rotateProviderToEnd(settings, provider);
          continue;
        }

        if (providerError.kind === 'rate_limited') {
          providerIndex = (providerIndex + 1) % providers.length;
          await sleep(1000);
          continue;
        }

        if (!settings.autoRetry) break;
        await sleep(backoffMs(attempts));
      }
    }

    if (!ok) {
      sendToTab(tabId, { type: 'TRANSLATE_FAILED', error: lastError });
      activeRuns.delete(tabId);
      return;
    }
  }

  if (!controller.signal.aborted) {
    sendToTab(tabId, {
      type: 'TRANSLATE_DONE',
      result: {
        providerId: lastUsedProvider?.id ?? '',
        segments: results,
        usage,
      },
    });
  }
  activeRuns.delete(tabId);
}

export function chunkSegments(
  segments: TranslationSegment[],
  maxChars: number,
): TranslationSegment[][] {
  const chunks: TranslationSegment[][] = [];
  let current: TranslationSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const length = segment.text.length;
    if (current.length > 0 && currentChars + length > maxChars) {
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
