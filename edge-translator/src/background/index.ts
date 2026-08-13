/**
 * MV3 Service Worker 入口。
 *
 * M2 将在这里实现完整 API 层（provider 抽象、分块、重试、key 轮换）。
 * 当前仅为可编译骨架：接收消息并回显消息类型。
 */
import type { RuntimeMessage } from '../shared/types';

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    const type = (message as { type?: string })?.type ?? 'unknown';
    sendResponse({ received: type });
    return false;
  },
);
