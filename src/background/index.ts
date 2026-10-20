/**
 * AirBrowse - Background Service Worker (MV3)
 * Handles tab lifecycle actions, zoom management, navigation, and AI page summarization securely in the extension context.
 */

import { summarizeText } from './gemini';

export const BACKGROUND_MESSAGES = {
  SUMMARIZE_PAGE: 'SUMMARIZE_PAGE',
  ZOOM: 'ZOOM',
  CLOSE_TAB: 'CLOSE_TAB',
  NEW_TAB: 'NEW_TAB',
  GO_BACK: 'GO_BACK',
  GO_FORWARD: 'GO_FORWARD',
} as const;

export interface ZoomMessage {
  type: typeof BACKGROUND_MESSAGES.ZOOM;
  delta: number;
}

export interface CloseTabMessage {
  type: typeof BACKGROUND_MESSAGES.CLOSE_TAB;
}

export interface NewTabMessage {
  type: typeof BACKGROUND_MESSAGES.NEW_TAB;
}

export interface GoBackMessage {
  type: typeof BACKGROUND_MESSAGES.GO_BACK;
}

export interface GoForwardMessage {
  type: typeof BACKGROUND_MESSAGES.GO_FORWARD;
}

export interface SummarizePageRequest {
  type: typeof BACKGROUND_MESSAGES.SUMMARIZE_PAGE;
  apiKey: string;
}

console.log('[AirBrowse] Background service worker initialized.');

async function getActiveTabId(senderTabId?: number): Promise<number | undefined> {
  if (senderTabId) return senderTabId;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    const msg = message as {
      type?: string;
      delta?: number;
      apiKey?: string;
    };

    // 1. ZOOM: Adjust tab zoom clamped between 0.25 and 5.0
    if (msg.type === BACKGROUND_MESSAGES.ZOOM) {
      (async () => {
        try {
          const tabId = await getActiveTabId(sender.tab?.id);
          if (!tabId) {
            sendResponse({ success: false, error: 'No active tab' });
            return;
          }
          const currentZoom = await chrome.tabs.getZoom(tabId);
          const delta = typeof msg.delta === 'number' ? msg.delta : 0;
          const nextZoom = Math.min(Math.max(currentZoom + delta, 0.25), 5.0);
          await chrome.tabs.setZoom(tabId, nextZoom);
          sendResponse({ success: true, zoom: nextZoom });
        } catch (err) {
          console.error('[AirBrowse] Zoom adjustment failed:', err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    }

    // 2. CLOSE_TAB: Close current tab
    if (msg.type === BACKGROUND_MESSAGES.CLOSE_TAB) {
      (async () => {
        try {
          const tabId = await getActiveTabId(sender.tab?.id);
          if (tabId) {
            await chrome.tabs.remove(tabId);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No tab found to close' });
          }
        } catch (err) {
          console.error('[AirBrowse] Close tab failed:', err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    }

    // 3. NEW_TAB: Open new browser tab
    if (msg.type === BACKGROUND_MESSAGES.NEW_TAB) {
      (async () => {
        try {
          const tab = await chrome.tabs.create({});
          sendResponse({ success: true, tabId: tab.id });
        } catch (err) {
          console.error('[AirBrowse] Open tab failed:', err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    }

    // 4. GO_BACK: Browser history back
    if (msg.type === BACKGROUND_MESSAGES.GO_BACK) {
      (async () => {
        try {
          const tabId = await getActiveTabId(sender.tab?.id);
          if (tabId) {
            if (typeof chrome.tabs.goBack === 'function') {
              await chrome.tabs.goBack(tabId);
            } else {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => window.history.back(),
              });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No active tab' });
          }
        } catch (err) {
          console.error('[AirBrowse] Go back failed:', err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    }

    // 5. GO_FORWARD: Browser history forward
    if (msg.type === BACKGROUND_MESSAGES.GO_FORWARD) {
      (async () => {
        try {
          const tabId = await getActiveTabId(sender.tab?.id);
          if (tabId) {
            if (typeof chrome.tabs.goForward === 'function') {
              await chrome.tabs.goForward(tabId);
            } else {
              await chrome.scripting.executeScript({
                target: { tabId },
                func: () => window.history.forward(),
              });
            }
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No active tab' });
          }
        } catch (err) {
          console.error('[AirBrowse] Go forward failed:', err);
          sendResponse({ success: false, error: String(err) });
        }
      })();
      return true;
    }

    // 6. SUMMARIZE_PAGE
    if (msg.type === BACKGROUND_MESSAGES.SUMMARIZE_PAGE && typeof msg.apiKey === 'string') {
      handleSummarizePage(msg.apiKey)
        .then((summary) => {
          sendResponse({ success: true, summary });
        })
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('[AirBrowse] Summarization failed:', errorMessage);
          sendResponse({ success: false, error: errorMessage });
        });
      return true;
    }

    return false;
  }
);

/**
 * Retrieves the active browser tab, extracts readable content, and invokes Gemini API.
 */
async function handleSummarizePage(apiKey: string): Promise<string> {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active browser tab found.');
  }

  let extractedText = '';
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'EXTRACT_TEXT',
    });
    if (response && typeof response.text === 'string') {
      extractedText = response.text;
    }
  } catch {
    // If content script is not responsive, fallback to scripting
  }

  if (!extractedText && activeTab.id) {
    const results = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: () => {
        const primaryContainer = document.querySelector(
          'article, main, [role="main"], #content, .content, .post-content'
        );
        const root = primaryContainer ?? document.body;
        if (!root) return '';

        const nodes = root.querySelectorAll('h1, h2, h3, p');
        const chunks: string[] = [];

        for (const el of Array.from(nodes)) {
          if (el instanceof HTMLElement && el.offsetParent !== null) {
            const text = el.innerText.trim();
            if (text.length > 0) chunks.push(text);
          }
        }

        const combined =
          chunks.length > 0 ? chunks.join('\n\n') : (document.body ? document.body.innerText : '');

        return combined.replace(/[ \t]+/g, ' ').slice(0, 3000);
      },
    });

    extractedText = (results?.[0]?.result as string) ?? '';
  }

  if (!extractedText.trim()) {
    throw new Error('Unable to extract readable text content from the current webpage.');
  }

  return await summarizeText(extractedText, apiKey);
}
