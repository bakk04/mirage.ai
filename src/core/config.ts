/**
 * AirBrowse - Configuration & Persistent Storage Module
 * Manages extension settings synchronized with chrome.storage.local.
 */

export type CursorSmoothing = 'low' | 'med' | 'high';
export type OpenMode = 'tab' | 'window';
export type ClickMode = 'single' | 'double';

export interface AirBrowseConfig {
  isEnabled: boolean;
  scrollSensitivity: number;
  cursorSmoothing: CursorSmoothing;
  leftHandedMode: boolean;
  openMode: OpenMode;
  clickMode: ClickMode;
  enableRefreshGesture: boolean;
  enableDangerousGestures: boolean;
}

export const DEFAULT_CONFIG: AirBrowseConfig = {
  // Control must be explicitly started from the popup so normal browsing is
  // never interrupted by camera access or injected controls.
  isEnabled: false,
  scrollSensitivity: 2.5,
  cursorSmoothing: 'med',
  leftHandedMode: false,
  openMode: 'tab',
  clickMode: 'single',
  enableRefreshGesture: true,
  enableDangerousGestures: false,
};

export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
export const GEMINI_API_KEY_STORAGE_KEY = 'airbrowse_gemini_api_key';

export const CONFIG_STORAGE_KEY = 'airbrowse_config';

export const MESSAGE_TYPES = {
  CONFIG_UPDATED: 'AIRBROWSE_CONFIG_UPDATED',
  GET_RUNTIME_STATUS: 'AIRBROWSE_GET_RUNTIME_STATUS',
} as const;

export interface RuntimeStatus {
  running: boolean;
  camera: string;
  mediapipe: string;
  hands: number;
  landmarks: string;
  gesture: string;
  confidence: number;
  stabilityFrames: number;
  lastCommand: string;
  commandResult: string;
  inferenceMs: number | null;
  fsmMs: number | null;
  commandDispatchMs: number | null;
  processingFps: number | null;
  error: string;
}

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

export async function loadGeminiApiKey(): Promise<string> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(GEMINI_API_KEY_STORAGE_KEY);
      const key = data?.[GEMINI_API_KEY_STORAGE_KEY];
      return typeof key === 'string' ? key : '';
    }
  } catch (error) {
    console.warn('[AirBrowse] Failed to load Gemini API key:', error);
  }
  return '';
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [GEMINI_API_KEY_STORAGE_KEY]: apiKey.trim() });
}
