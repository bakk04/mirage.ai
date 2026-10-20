/**
 * AirBrowse - Configuration & Persistent Storage Module
 * Manages extension settings synchronized with chrome.storage.local.
 */

export type CursorSmoothing = 'low' | 'med' | 'high';
export type OpenMode = 'tab' | 'window';

export interface AirBrowseConfig {
  isEnabled: boolean;
  scrollSensitivity: number;
  cursorSmoothing: CursorSmoothing;
  leftHandedMode: boolean;
  openMode: OpenMode;
}

export const DEFAULT_CONFIG: AirBrowseConfig = {
  isEnabled: true,
  scrollSensitivity: 2.5,
  cursorSmoothing: 'med',
  leftHandedMode: false,
  openMode: 'tab',
};

export const DEFAULT_GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

export const CONFIG_STORAGE_KEY = 'airbrowse_config';

export const MESSAGE_TYPES = {
  CONFIG_UPDATED: 'AIRBROWSE_CONFIG_UPDATED',
} as const;

export interface ConfigUpdatedMessage {
  type: typeof MESSAGE_TYPES.CONFIG_UPDATED;
  payload: AirBrowseConfig;
}

/**
 * Loads current settings from chrome.storage.local with automatic default fallback.
 */
export async function loadConfig(): Promise<AirBrowseConfig> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
      if (data && data[CONFIG_STORAGE_KEY]) {
        return {
          ...DEFAULT_CONFIG,
          ...data[CONFIG_STORAGE_KEY],
        };
      }
    }
  } catch (error) {
    console.warn('[AirBrowse] Failed to load configuration from storage:', error);
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Persists updated settings to chrome.storage.local.
 */
export async function saveConfig(updates: Partial<AirBrowseConfig>): Promise<AirBrowseConfig> {
  const current = await loadConfig();
  const nextConfig: AirBrowseConfig = {
    ...current,
    ...updates,
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: nextConfig });
    }
  } catch (error) {
    console.error('[AirBrowse] Failed to save configuration to storage:', error);
  }

  return nextConfig;
}
