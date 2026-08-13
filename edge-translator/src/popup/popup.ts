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
    if (!master.checked) sendToActiveTab({ type: 'POPUP_COMMAND', command: 'restore' });
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
    if (!settings.masterEnabled) return;
    sendToActiveTab({ type: 'POPUP_COMMAND', command: 'translate' });
  });

  document.getElementById('restore-btn')?.addEventListener('click', () => {
    sendToActiveTab({ type: 'POPUP_COMMAND', command: 'restore' });
  });

  document.getElementById('options-btn')?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
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

function sendToActiveTab(message: PopupCommandMessage): void {
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      // 受限页面或 content script 未注入：忽略
    }
  })();
}

async function persist(): Promise<void> {
  await saveSettings(settings);
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => {});
}
