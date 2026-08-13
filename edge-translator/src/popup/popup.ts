import './popup.css';
import { getSettings, saveSettings } from '../shared/storage';
import type {
  ContentStatusMessage,
  ExtensionSettings,
  PopupCommand,
  PopupCommandMessage,
} from '../shared/types';

let settings: ExtensionSettings;
let tabStatus: ContentStatusMessage | undefined;

document.addEventListener('DOMContentLoaded', () => {
  void init();
});

async function init(): Promise<void> {
  settings = await getSettings();
  bindControls();
  render();
  tabStatus = await queryTabStatus();
  renderButtons();
}

function bindControls(): void {
  const master = document.getElementById('master-enabled') as HTMLInputElement;
  master.addEventListener('change', async () => {
    settings.masterEnabled = master.checked;
    await persist();
    if (!master.checked) {
      const tabId = await getActiveTabId();
      if (tabId !== undefined) await sendCommand(tabId, 'restore');
    }
    renderButtons();
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
    void onMainButtonClick();
  });

  document.getElementById('restore-btn')?.addEventListener('click', () => {
    void onRestoreClick();
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
}

/**
 * 根据页面状态渲染按钮：
 * - 无缓存：翻译本页（需总开关+key）
 * - 有缓存且显示译文：重新翻译（清缓存）+ 显示原文
 * - 有缓存且已恢复原文：显示翻译（应用缓存，不调用 AI）
 */
function renderButtons(): void {
  const translateBtn = document.getElementById('translate-btn') as HTMLButtonElement;
  const restoreBtn = document.getElementById('restore-btn') as HTMLButtonElement;
  const provider = settings.providers.find(
    (item) => item.enabled && item.apiKey.trim() !== '',
  );
  const hasCache = tabStatus?.hasCache ?? false;
  const showing = tabStatus?.showingTranslation ?? false;

  if (hasCache) {
    translateBtn.textContent = showing ? '重新翻译' : '显示翻译';
    restoreBtn.hidden = !showing;
    translateBtn.disabled = showing
      ? !settings.masterEnabled || !provider
      : false; // 显示翻译只读缓存，不调用 AI
  } else {
    translateBtn.textContent = '翻译本页';
    restoreBtn.hidden = true;
    translateBtn.disabled = !settings.masterEnabled || !provider;
  }
}

function mainCommand(): PopupCommand {
  if (tabStatus?.hasCache) {
    return tabStatus.showingTranslation ? 'retranslate' : 'show-translation';
  }
  return 'translate';
}

async function onMainButtonClick(): Promise<void> {
  hideHint();
  const tabId = await getActiveTabId();
  if (tabId === undefined) return;
  const reason = await ensureContentScript(tabId);
  if (reason) {
    showHint(reason);
    return;
  }
  const command = mainCommand();
  const ok = await sendCommand(tabId, command);
  if (!ok) {
    showHint('翻译指令发送失败，请刷新页面后重试。');
    return;
  }
  if (command === 'translate' || command === 'retranslate') {
    window.close();
  } else {
    tabStatus = await queryTabStatus();
    renderButtons();
  }
}

async function onRestoreClick(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) return;
  const ok = await sendCommand(tabId, 'restore');
  if (ok) {
    tabStatus = await queryTabStatus();
    renderButtons();
  }
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

async function sendCommand(
  tabId: number,
  command: PopupCommand,
): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'POPUP_COMMAND',
      command,
    } satisfies PopupCommandMessage);
    return true;
  } catch {
    return false;
  }
}

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
      return '检测到扩展仍是旧版本：请到 edge://extensions 刷新扩展，并确认弹窗底部显示 v0.1.3 后再试。';
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
