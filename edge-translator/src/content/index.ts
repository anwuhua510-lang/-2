/**
 * Content Script 入口（M3）。
 *
 * 职责：提取文本块 → 发送 TRANSLATE_PAGE → 接收分块结果替换 DOM →
 * 进度展示 → 一键恢复原文。不做任何 API 请求。
 */
import {
  type RuntimeMessage,
  type SegmentTranslation,
  type TranslationRequest,
} from '../shared/types';
import { getSettings } from '../shared/storage';
import { extractBlocks, type ExtractedBlock } from './extract';
import { TranslationBar } from './ui';

interface PageState {
  blocks: ExtractedBlock[];
  applied: Set<string>;
  bar: TranslationBar;
  truncated: boolean;
  translating: boolean;
}

let state: PageState | null = null;

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === 'POPUP_COMMAND') {
    if (message.command === 'translate') void handleTranslateCommand();
    if (message.command === 'restore') restoreOriginal();
    if (message.command === 'get-status') {
      sendResponse({
        type: 'CONTENT_STATUS',
        translated: state !== null && state.applied.size > 0,
      });
      return false;
    }
    sendResponse({ received: message.command });
    return;
  }
  if (message.type === 'TRANSLATE_CHUNK') {
    applyChunk(message.segments);
    return;
  }
  if (message.type === 'TRANSLATE_PROGRESS') {
    state?.bar.update(message.done, message.total, message.providerName);
    return;
  }
  if (message.type === 'TRANSLATE_DONE') {
    if (state) {
      state.bar.complete(state.truncated);
      state.translating = false;
      const bar = state.bar;
      // 完成后短暂展示，数秒后自动关闭（恢复原文仍可在弹窗中操作）
      setTimeout(() => bar.remove(), 3000);
    }
    return;
  }
  if (message.type === 'TRANSLATE_FAILED') {
    if (state) {
      state.bar.fail(message.error);
      state.bar.addButton('关闭', () => {
        restoreOriginal();
      });
      state.translating = false;
    }
  }
  return false;
  },
);

async function handleTranslateCommand(): Promise<void> {
  if (state?.translating) return;

  const settings = await getSettings();
  if (!settings.masterEnabled) {
    restoreOriginal();
    return;
  }

  const { blocks, truncated } = extractBlocks(
    document.body,
    settings.maxTextBlocksPerPage,
  );
  if (blocks.length === 0) return;

  state = {
    blocks,
    applied: new Set(),
    bar: new TranslationBar(),
    truncated,
    translating: true,
  };
  state.bar.update(0, blocks.length, '准备中');

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
    if (state) {
      state.bar.fail({
        kind: 'network',
        message: '无法连接扩展后台，请刷新页面后重试',
        retryable: false,
      });
      state.translating = false;
    }
  }
}

function applyChunk(segments: SegmentTranslation[]): void {
  if (!state) return;
  for (const segment of segments) {
    if (state.applied.has(segment.id)) continue;
    const block = state.blocks[Number(segment.id)];
    if (!block) continue;
    block.nodes[0].nodeValue = segment.text;
    for (let i = 1; i < block.nodes.length; i++) {
      block.nodes[i].nodeValue = '';
    }
    state.applied.add(segment.id);
  }
}

function restoreOriginal(): void {
  if (!state) return;
  for (const block of state.blocks) {
    block.nodes.forEach((node, index) => {
      node.nodeValue = block.original[index] ?? '';
    });
  }
  state.bar.remove();
  state = null;
}
