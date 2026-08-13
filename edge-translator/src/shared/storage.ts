import { DEFAULT_SETTINGS, type ExtensionSettings } from './types';

export const SETTINGS_STORAGE_KEY = 'settings';

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = stored[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined;
  if (!raw) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    proxy: { ...DEFAULT_SETTINGS.proxy, ...(raw.proxy ?? {}) },
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}
