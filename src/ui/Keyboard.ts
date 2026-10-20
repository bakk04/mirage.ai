/**
 * AirBrowse - Virtual Keyboard Component (Shadow DOM)
 * Bottom-docked virtual keyboard with large interactive keys:
 * - AZERTY / QWERTY layout toggle
 * - Shift (case toggle), Space, Backspace, Enter, Close
 * - Numbers and Symbols layer toggle (?123 / ABC)
 * - Key activation via quick pinch OR dwell (1000 ms hover)
 * - Inserts text into focused input/textarea/contenteditable with React-compatible native setter and input events
 * - Opens automatically when a click lands on an editable field
 */

import { typeCharacter, backspaceCharacter, insertNewline } from '../core/keyboard';
import { playClickSound } from '../core/audio';
import { GESTURE_CONFIG } from '../core/math';

export type KeyboardLayout = 'AZERTY' | 'QWERTY';
export type KeyboardLayer = 'ALPHA' | 'SYMBOLS';

export interface KeyboardResult {
  consumed: boolean;
  keyActivated?: string;
  dwellProgress?: number;
}

export class KeyboardUI {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private containerEl: HTMLElement | null = null;

  public isOpen = false;
  private layout: KeyboardLayout = 'AZERTY';
  private layer: KeyboardLayer = 'ALPHA';
  private isShift = false;
  private composedText = '';

  // Dwell state
  private currentlyHoveredKey: HTMLElement | null = null;
  private dwellStartTime = 0;
  private lastActivationTime = -Infinity;

  constructor() {
    this.initDOM();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('airbrowse-keyboard-host')) return;

    const host = document.createElement('div');
    host.id = 'airbrowse-keyboard-host';
    Object.assign(host.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%) translateY(120%)',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
      transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
      userSelect: 'none',
    });

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
      }
      .keyboard-panel {
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(32px);
        -webkit-backdrop-filter: blur(32px);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 24px;
        box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.65), 0 0 30px rgba(0, 240, 255, 0.15);
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 700px;
        box-sizing: border-box;
      }
      .keyboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        margin-bottom: 4px;
      }
      .keyboard-output {
        width: 100%;
        min-height: 34px;
        padding: 8px 10px;
        border-radius: 8px;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.25);
        color: rgba(255, 255, 255, 0.9);
        font-size: 13px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .keyboard-title {
        font-size: 12px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .keyboard-title-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #00f0ff;
        box-shadow: 0 0 8px #00f0ff;
      }
      .keyboard-row {
        display: flex;
        justify-content: center;
        gap: 6px;
      }
      .key {
        position: relative;
        min-width: 44px;
        height: 50px;
        flex: 1;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #ffffff;
        font-size: 17px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-sizing: border-box;
        overflow: hidden;
        transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .key.hovered {
        transform: scale(1.08);
        background: rgba(255, 255, 255, 0.22);
        border-color: #00f0ff;
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.5);
      }
      .key-dwell-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        width: 0%;
        background: #00f0ff;
        box-shadow: 0 0 8px #00f0ff;
        transition: width 0.05s linear;
      }
      .key.key-wide {
        flex: 1.5;
        font-size: 13px;
        background: rgba(255, 255, 255, 0.06);
      }
      .key.key-space {
        flex: 4;
        font-size: 13px;
      }
      .key.key-active {
        background: #00f0ff;
        color: #0f172a;
        border-color: #ffffff;
        box-shadow: 0 0 14px rgba(0, 240, 255, 0.8);
      }
      .key.key-close {
        flex: 1;
        background: rgba(239, 68, 68, 0.18);
        border-color: rgba(239, 68, 68, 0.4);
        color: #fca5a5;
      }
      .key.key-close.hovered {
        background: rgba(239, 68, 68, 0.4);
        border-color: #ef4444;
        box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
      }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'keyboard-panel';
    shadow.appendChild(container);

    document.documentElement.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.containerEl = container;

    this.render();
  }

  public open(): void {
    if (!this.host) return;
    this.isOpen = true;
    this.host.style.opacity = '1';
    this.host.style.transform = 'translateX(-50%) translateY(0)';
  }

  public close(): void {
    if (!this.host) return;
    this.isOpen = false;
    this.host.style.opacity = '0';
    this.host.style.transform = 'translateX(-50%) translateY(120%)';
    this.clearHover();
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Hit tests cursor position on keyboard keys.
   * Supports dwell activation (1000 ms hover) with progress bar feedback.
   */
  public updateCursor(
    screenX: number,
    screenY: number,
    timestamp: number = performance.now()
  ): KeyboardResult {
    if (!this.isOpen || !this.shadow || !this.host) {
      return { consumed: false };
    }

    const hostRect = this.host.getBoundingClientRect();
    const isInsidePanel =
      screenX >= hostRect.left &&
      screenX <= hostRect.right &&
      screenY >= hostRect.top &&
      screenY <= hostRect.bottom;

    if (!isInsidePanel) {
      this.clearHover();
      return { consumed: false };
    }

    // Hit test keys
    const el = this.shadow.elementFromPoint(screenX, screenY);
    const keyEl = (el && el.classList.contains('key') ? el : el?.closest('.key')) as HTMLElement | null;

    if (!keyEl) {
      this.clearHover();
      return { consumed: true }; // Inside panel background
    }

    // Cooldown check (800 ms)
    if (timestamp - this.lastActivationTime < GESTURE_CONFIG.actionCooldownMs) {
      return { consumed: true };
    }

    if (keyEl !== this.currentlyHoveredKey) {
      this.clearHover();
      this.currentlyHoveredKey = keyEl;
      this.dwellStartTime = timestamp;
      keyEl.classList.add('hovered');
    }

    // Dwell progress calculation
    const elapsed = timestamp - this.dwellStartTime;
    const progress = Math.min(Math.max(elapsed / GESTURE_CONFIG.dwellStandardMs, 0), 1.0);

    const progressBar = keyEl.querySelector('.key-dwell-progress') as HTMLElement | null;
    if (progressBar) {
      progressBar.style.width = `${progress * 100}%`;
    }

    // Dwell reached 100%: activate key!
    if (progress >= 1.0) {
      this.lastActivationTime = timestamp;
      const action = keyEl.dataset.action;
      const value = keyEl.dataset.val;
      this.clearHover();
      this.executeKey(action, value);
      return { consumed: true, keyActivated: value ?? action, dwellProgress: 1.0 };
    }

    return { consumed: true, dwellProgress: progress };
  }

  /**
   * Handles quick pinch click on keyboard keys.
   */
  public handleClick(
    screenX: number,
    screenY: number,
    timestamp: number = performance.now()
  ): boolean {
    if (!this.isOpen || !this.shadow || !this.host) return false;

    const hostRect = this.host.getBoundingClientRect();
    if (
      screenX < hostRect.left ||
      screenX > hostRect.right ||
      screenY < hostRect.top ||
      screenY > hostRect.bottom
    ) {
      return false;
    }

    if (timestamp - this.lastActivationTime < GESTURE_CONFIG.actionCooldownMs) {
      return true;
    }

    const el = this.shadow.elementFromPoint(screenX, screenY);
    const keyEl = (el && el.classList.contains('key') ? el : el?.closest('.key')) as HTMLElement | null;

    if (!keyEl) return true;

    this.lastActivationTime = timestamp;
    this.clearHover();
    this.executeKey(keyEl.dataset.action, keyEl.dataset.val);
    return true;
  }

  public clearHover(): void {
    if (this.currentlyHoveredKey) {
      this.currentlyHoveredKey.classList.remove('hovered');
      const bar = this.currentlyHoveredKey.querySelector('.key-dwell-progress') as HTMLElement | null;
      if (bar) bar.style.width = '0%';
      this.currentlyHoveredKey = null;
      this.dwellStartTime = 0;
    }
  }

  private executeKey(action?: string, value?: string): void {
    playClickSound();

    if (action === 'CHAR' && value) {
      const charToType = this.isShift ? value.toUpperCase() : value.toLowerCase();
      typeCharacter(charToType);
      this.composedText += charToType;
      this.isShift = false;
      this.render();
    } else if (action === 'BACKSPACE') {
      backspaceCharacter();
      this.composedText = this.composedText.slice(0, -1);
      this.render();
    } else if (action === 'ENTER') {
      insertNewline();
    } else if (action === 'SPACE') {
      typeCharacter(' ');
      this.composedText += ' ';
      this.render();
    } else if (action === 'SHIFT') {
      this.isShift = !this.isShift;
      this.render();
    } else if (action === 'LAYOUT') {
      this.layout = this.layout === 'AZERTY' ? 'QWERTY' : 'AZERTY';
      this.render();
    } else if (action === 'LAYER') {
      this.layer = this.layer === 'ALPHA' ? 'SYMBOLS' : 'ALPHA';
      this.render();
    } else if (action === 'CLOSE') {
      this.close();
    } else if (action === 'CLEAR') {
      this.composedText = '';
      this.render();
    }
  }

  private render(): void {
    if (!this.containerEl) return;

    this.containerEl.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'keyboard-header';
    header.innerHTML = `
      <div class="keyboard-title">
        <span class="keyboard-title-dot"></span>
        <span>Virtual Keyboard &bull; ${this.layout}</span>
      </div>
      <div style="font-size: 11px; color: rgba(255,255,255,0.6);">Hover 1s or Quick Pinch to Type</div>
    `;
    this.containerEl.appendChild(header);
    const output = document.createElement('div');
    output.className = 'keyboard-output';
    output.textContent = this.composedText || 'Point and pinch to type…';
    output.setAttribute('aria-live', 'polite');
    this.containerEl.appendChild(output);

    // Layout rows
    let row1: string[];
    let row2: string[];
    let row3: string[];

    if (this.layer === 'SYMBOLS') {
      row1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
      row2 = ['@', '#', '$', '%', '&', '*', '-', '+', '(', ')'];
      row3 = ['!', '"', "'", ':', ';', ',', '?', '.', '/'];
    } else if (this.layout === 'AZERTY') {
      row1 = ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
      row2 = ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'];
      row3 = ['W', 'X', 'C', 'V', 'B', 'N'];
    } else {
      // QWERTY
      row1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
      row2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
      row3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
    }

    // Row 1
    const r1El = document.createElement('div');
    r1El.className = 'keyboard-row';
    for (const char of row1) {
      r1El.appendChild(this.createKey('CHAR', char, this.isShift ? char.toUpperCase() : char.toLowerCase()));
    }
    this.containerEl.appendChild(r1El);

    // Row 2
    const r2El = document.createElement('div');
    r2El.className = 'keyboard-row';
    for (const char of row2) {
      r2El.appendChild(this.createKey('CHAR', char, this.isShift ? char.toUpperCase() : char.toLowerCase()));
    }
    this.containerEl.appendChild(r2El);

    // Row 3
    const r3El = document.createElement('div');
    r3El.className = 'keyboard-row';

    if (this.layer === 'ALPHA') {
      const shiftKey = this.createKey(
        'SHIFT',
        'SHIFT',
        '⇧ Shift',
        `key-wide ${this.isShift ? 'key-active' : ''}`
      );
      r3El.appendChild(shiftKey);
    }

    for (const char of row3) {
      r3El.appendChild(this.createKey('CHAR', char, this.isShift ? char.toUpperCase() : char.toLowerCase()));
    }

    const backspaceKey = this.createKey('BACKSPACE', 'BACKSPACE', '⌫', 'key-wide');
    r3El.appendChild(backspaceKey);
    this.containerEl.appendChild(r3El);

    // Row 4: Controls & Space
    const r4El = document.createElement('div');
    r4El.className = 'keyboard-row';

    const layerKey = this.createKey(
      'LAYER',
      'LAYER',
      this.layer === 'ALPHA' ? '?123' : 'ABC',
      'key-wide'
    );
    r4El.appendChild(layerKey);

    const layoutKey = this.createKey('LAYOUT', 'LAYOUT', this.layout, 'key-wide');
    r4El.appendChild(layoutKey);

    const spaceKey = this.createKey('SPACE', ' ', 'Space', 'key-space');
    r4El.appendChild(spaceKey);

    const enterKey = this.createKey('ENTER', 'ENTER', '↵ Enter', 'key-wide');
    r4El.appendChild(enterKey);

    const closeKey = this.createKey('CLOSE', 'CLOSE', '✕', 'key-close');
    r4El.appendChild(closeKey);
    const clearKey = this.createKey('CLEAR', 'CLEAR', 'Clear', 'key-wide');
    r4El.appendChild(clearKey);

    this.containerEl.appendChild(r4El);
  }

  private createKey(
    action: string,
    value: string,
    displayLabel: string,
    extraClasses = ''
  ): HTMLElement {
    const key = document.createElement('div');
    key.className = `key ${extraClasses}`.trim();
    key.dataset.action = action;
    key.dataset.val = value;
    key.textContent = displayLabel;

    // Progress bar for dwell feedback
    const progressBar = document.createElement('div');
    progressBar.className = 'key-dwell-progress';
    key.appendChild(progressBar);

    return key;
  }

  public destroy(): void {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.containerEl = null;
    }
  }
}
