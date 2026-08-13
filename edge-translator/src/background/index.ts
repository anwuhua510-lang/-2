/**
 * MV3 Service Worker 入口。
 *
 * 路由消息：TRANSLATE_PAGE 交给编排器处理，其余消息回显类型。
 */
import type { RuntimeMessage } from '../shared/types';
import { handleTranslatePage } from './translate';

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse) => {
    if (message?.type === 'INJECT_CONTENT') {
      const js = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
      chrome.scripting
        .executeScript({ target: { tabId: message.tabId }, files: js })
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          const detail =
            error instanceof Error ? error.message : String(error);
          console.error('[eat] content script injection failed:', error);
          sendResponse({ ok: false, error: detail || 'injection failed' });
        });
      return true;
    }
    if (message?.type === 'TRANSLATE_PAGE') {
      const tabId = _sender.tab?.id;
      if (tabId === undefined) {
        sendResponse({ ok: false });
        return false;
      }
      handleTranslatePage(message.request, tabId).catch(() => {
        // 编排器内部已处理错误消息，此处兜底
      });
      sendResponse({ ok: true });
      return false;
    }
    const type = (message as { type?: string })?.type ?? 'unknown';
    sendResponse({ received: type });
    return false;
  },
);
