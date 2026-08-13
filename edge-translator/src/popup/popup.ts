import './popup.css';
import { getSettings, saveSettings } from '../shared/storage';
import type {
  ContentStatusMessage,
  ExtensionSettings,
  PopupCommandMessage,
} from '../shared/types';

let settings: ExtensionSettings;

document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init(): Promise<void> {
  settings = await getSettings();
  bindControls();
  render();
  void refreshTabStatus();
}

function bindControls(): void {
  const master = document.getElementById('master-enabled') as HTMLInputElement;
  master.addEventListener('change', async () => {
    settings.masterEnabled = master.checked;
    await persist();
    if (!master.checked) void restoreActiveTab();
  });

  const source = document.getElementById('source-language') as HTMLSelectElement;
  source.addEventListener('change', async () => {
    settings.sourceLanguage = source.value as ExtensionSettings['sourceLanguage'];
    await persist();
  });

  const target = document.getElementById('target-language') as HTMLSelectElement;
  target.addEventListener('change', async () => {
    settings.targetLanguage = target.value as ExtensionSettings['targetLanguage'];
    await persist();
  });

  document.getElementById('translate-btn')?.addEventListener('click', () => {
    void translateActiveTab();
  });

  document.getElementById('restore-btn')?.addEventListener('click', () => {
    void restoreActiveTab();
  });

  document.getElementById('options-btn')?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  const version = document.getElementById('popup-version');
  if (version) {
    version.textContent = `v${chrome.runtime.getManifest().version}`;
  }
}

function render(): void {
  (document.getElementById('master-enabled') as HTMLInputElement).checked =
    settings.masterEnabled;
  (document.getElementById('source-language') as HTMLSelectElement).value =
    settings.sourceLanguage;
  (document.getElementById('target-language') as HTMLSelectElement).value =
    settings.targetLanguage;

  const provider = settings.providers.find(
    (item) => item.enabled && item.apiKey.trim() !== '',
  );
  const info = document.getElementById('provider-info');
  if (!info) return;
  if (provider) {
    info.textContent = `当前引擎：${provider.name}（${provider.model}）`;
  } else {
    info.textContent = '尚未配置 API key，请打开设置添加';
  }

  (document.getElementById('translate-btn') as HTMLButtonElement).disabled =
    !settings.masterEnabled || !provider;
}

async function refreshTabStatus(): Promise<void> {
  const status = await queryTabStatus();
  const restore = document.getElementById('restore-btn');
  if (restore) restore.hidden = !status?.translated;
}

async function queryTabStatus(): Promise<ContentStatusMessage | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return undefined;
  try {
    return (await chrome.tabs.sendMessage(tab.id, {
      type: 'POPUP_COMMAND',
      command: 'get-status',
    } satisfies PopupCommandMessage)) as ContentStatusMessage;
  } catch {
    return undefined;
  }
}

async function translateActiveTab(): Promise<void> {
  hideHint();
  const tabId = await getActiveTabId();
  if (tabId === undefined) return;
  const reason = await ensureContentScript(tabId);
  if (reason) {
    showHint(reason);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'POPUP_COMMAND',
      command: 'translate',
    } satisfies PopupCommandMessage);
    window.close();
  } catch {
    showHint('翻译指令发送失败，请刷新页面后重试。');
  }
}

async function restoreActiveTab(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'POPUP_COMMAND',
      command: 'restore',
    } satisfies PopupCommandMessage);
  } catch {
    // 页面未注入 content script 时无需恢复
  }
}

/**
 * 确保 content script 已注入：先探测，失败则请求 background 用
 * chrome.scripting 动态注入（依赖点击扩展图标授予的 activeTab 权限）。
 */
/**
 * 确保 content script 可用。返回 null 表示就绪；否则返回面向用户的失败原因。
 */
async function ensureContentScript(tabId: number): Promise<string | null> {
  if (await probeContentScript(tabId)) return null;

  let response: { ok?: boolean; error?: string; raw?: string };
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'INJECT_CONTENT',
      tabId,
    })) as { ok?: boolean; error?: string; raw?: string };
  } catch {
    return '无法连接扩展后台，请刷新页面后重试。';
  }

  if (!response.ok) {
    if ('received' in (response as object)) {
      return '检测到扩展仍是旧版本：请到 edge://extensions 刷新扩展，并确认弹窗底部显示 v0.1.1 后再试。';
    }
    const error = response.error ?? response.raw ?? '';
    if (
      error.includes('Cannot access') ||
      error.includes('cannot be accessed') ||
      error.includes('No host permissions')
    ) {
      return '当前页面不支持扩展（内置页面或受限页面），请换一个普通网页，或刷新后重试。';
    }
    if (!response.error && !response.raw) {
      return `扩展响应异常（${JSON.stringify(response)}），请刷新扩展后重试。`;
    }
    return `页面注入失败：${error}。请刷新页面后重试。`;
  }

  // content script 通过动态 import 加载主模块，监听器注册有延迟；
  // 轮询等待其就绪（最长约 5 秒），避免指令发到空接收端。
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await probeContentScript(tabId)) return null;
    await sleep(250);
  }
  return '页面脚本加载超时，请刷新页面后重试。';
}

async function probeContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'POPUP_COMMAND',
      command: 'get-status',
    } satisfies PopupCommandMessage);
    return true;
  } catch {
    return false;
  }
}

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function showHint(message: string): void {
  const hint = document.getElementById('popup-hint');
  if (!hint) return;
  hint.textContent = message;
  hint.hidden = false;
}

function hideHint(): void {
  const hint = document.getElementById('popup-hint');
  if (hint) hint.hidden = true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persist(): Promise<void> {
  await saveSettings(settings);
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
}
