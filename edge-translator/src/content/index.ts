/**
 * Content Script 入口（M3+）。
 *
 * 职责：提取文本块 → 发送 TRANSLATE_PAGE → 接收分块结果替换 DOM →
 * 进度展示 → 缓存管理（恢复原文 / 显示翻译 / 重新翻译）。
 *
 * 缓存语义：翻译结果保存在页面会话内存中（刷新页面即清空）。
 * - restore：显示原文，保留缓存
 * - show-translation：直接应用缓存，不调用 AI
 * - retranslate：清空缓存后重新调用 AI
 */
import {
  type RuntimeMessage,
  type SegmentTranslation,
  type TranslationRequest,
} from '../shared/types';
import { getSettings } from '../shared/storage';
import { extractBlocks, type ExtractedBlock } from './extract';
import { TranslationBar } from './ui';

interface TranslationCache {
  blocks: ExtractedBlock[];
  translations: Map<string, string>;
  truncated: boolean;
}

interface ActiveRun {
  bar: TranslationBar;
  translating: boolean;
}

let cache: TranslationCache | null = null;
let activeRun: ActiveRun | null = null;
let showingTranslation = false;

const g = globalThis as { __eatInjected?: boolean };
if (!g.__eatInjected) {
  g.__eatInjected = true;
  chrome.runtime.onMessage.addListener(
    (message: RuntimeMessage, _sender, sendResponse) => {
      if (message.type === 'POPUP_COMMAND') {
        switch (message.command) {
          case 'translate':
            void startTranslation('fresh');
            break;
          case 'retranslate':
            void startTranslation('retranslate');
            break;
          case 'show-translation':
            showCachedTranslation();
            break;
          case 'restore':
            restoreOriginal();
            break;
          case 'get-status':
            sendResponse({
              type: 'CONTENT_STATUS',
              translated: cache !== null,
              showingTranslation,
              hasCache: cache !== null,
            });
            return false;
        }
        sendResponse({ received: message.command });
        return false;
      }
      if (message.type === 'TRANSLATE_CHUNK') {
        applyChunk(message.segments);
        return false;
      }
      if (message.type === 'TRANSLATE_PROGRESS') {
        activeRun?.bar.update(
          message.done,
          message.total,
          message.providerName,
        );
        return false;
      }
      if (message.type === 'TRANSLATE_DONE') {
        if (activeRun) {
          activeRun.bar.complete(cache?.truncated ?? false);
          activeRun.translating = false;
          const bar = activeRun.bar;
          // 完成 1 秒后淡出消失（显示原文/显示翻译仍可在弹窗中操作）
          setTimeout(() => bar.fadeOut(), 1000);
        }
        return false;
      }
      if (message.type === 'TRANSLATE_FAILED') {
        if (activeRun) {
          activeRun.bar.fail(message.error);
          activeRun.bar.addButton('关闭', () => restoreOriginal());
          activeRun.translating = false;
        }
        return false;
      }
      return false;
    },
  );
}

async function startTranslation(
  mode: 'fresh' | 'retranslate',
): Promise<void> {
  if (activeRun?.translating) return;
  if (mode === 'retranslate') {
    clearCacheAndRestore();
  } else if (cache) {
    return; // 已有缓存时忽略 fresh（弹窗此时应发送 retranslate）
  }

  const settings = await getSettings();
  if (!settings.masterEnabled) return;

  const { blocks, truncated } = extractBlocks(
    document.body,
    settings.maxTextBlocksPerPage,
  );
  if (blocks.length === 0) return;

  cache = { blocks, translations: new Map(), truncated };
  showingTranslation = true;
  activeRun = { bar: new TranslationBar(), translating: true };
  activeRun.bar.update(0, blocks.length, '准备中');

  const request: TranslationRequest = {
    providerId: '',
    segments: blocks.map((block) => ({ id: block.id, text: block.text })),
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    glossary: settings.glossary,
  };

  try {
    await chrome.runtime.sendMessage({
      type: 'TRANSLATE_PAGE',
      request,
    } satisfies RuntimeMessage);
  } catch {
    if (activeRun) {
      activeRun.bar.fail({
        kind: 'network',
        message: '无法连接扩展后台，请刷新页面后重试',
        retryable: false,
      });
      activeRun.translating = false;
    }
  }
}

function applyChunk(segments: SegmentTranslation[]): void {
  if (!cache) return;
  for (const segment of segments) {
    if (cache.translations.has(segment.id)) continue;
    cache.translations.set(segment.id, segment.text);
    if (!showingTranslation) continue; // 已恢复原文：只缓存不显示
    const block = cache.blocks[Number(segment.id)];
    if (!block) continue;
    block.nodes[0].nodeValue = segment.text;
    for (let i = 1; i < block.nodes.length; i++) {
      block.nodes[i].nodeValue = '';
    }
  }
}

function showCachedTranslation(): void {
  if (!cache) return;
  for (const block of cache.blocks) {
    const text = cache.translations.get(block.id);
    if (text === undefined) continue;
    block.nodes[0].nodeValue = text;
    for (let i = 1; i < block.nodes.length; i++) {
      block.nodes[i].nodeValue = '';
    }
  }
  showingTranslation = true;
}

function restoreOriginal(): void {
  if (activeRun) {
    activeRun.bar.remove();
    activeRun = null;
  }
  if (!cache) return;
  for (const block of cache.blocks) {
    block.nodes.forEach((node, index) => {
      node.nodeValue = block.original[index] ?? '';
    });
  }
  showingTranslation = false;
}

function clearCacheAndRestore(): void {
  restoreOriginal();
  cache = null;
  showingTranslation = false;
}
