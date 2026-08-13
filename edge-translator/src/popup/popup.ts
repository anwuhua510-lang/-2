import './popup.css';
import type { PopupCommandMessage } from '../shared/types';

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('translate-btn');
  button?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    const message: PopupCommandMessage = {
      type: 'POPUP_COMMAND',
      command: 'translate',
    };
    chrome.tabs.sendMessage(tab.id, message).catch(() => {
      // 页面尚未注入 content script 或处于受限页面时忽略
    });
  });
});
