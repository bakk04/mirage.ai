/**
 * AirBrowse - Virtual Keyboard Component (Shadow DOM)
 * Vision Pro glassmorphic bottom-docked virtual keyboard with large interactive keys:
 * - AZERTY layout by default with QWERTY toggle
 * - Shift (lowercase/uppercase), Space, Backspace, Enter, Close
 * - Numbers and Symbols layer toggle (?123 / ABC)
 * - Hover highlight with dwell feedback
 * - Quick pinch key selection with React/Vue native value setter and contenteditable support
 */

import { typeCharacter, backspaceCharacter, insertNewline } from '../core/keyboard';
import { playClickSound } from '../core/audio';

export type KeyboardLayout = 'AZERTY' | 'QWERTY';
export type KeyboardLayer = 'ALPHA' | 'SYMBOLS';

export class VirtualKeyboardUI {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private containerEl: HTMLElement | null = null;

  public isOpen = false;
  private layout: KeyboardLayout = 'AZERTY';
  private layer: KeyboardLayer = 'ALPHA';
  private isShift = false;

  private currentHoveredKey: HTMLElement | null = null;

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
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%) translateY(120%)',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '2147483646',
      transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
    });

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
      }
      .keyboard-panel {
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(32px);
        -webkit-backdrop-filter: blur(32px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 24px;
        box-shadow: 0 24px 60px -10px rgba(0, 0, 0, 0.6), 0 0 30px rgba(0, 240, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2);
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 680px;
        box-sizing: border-box;
        user-select: none;
      }
      .keyboard-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 4px;
      }
      .keyboard-title {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.7);
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
        min-width: 44px;
        height: 48px;
        flex: 1;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #ffffff;
        font-size: 16px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: transform 0.12s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
        box-sizing: border-box;
      }
      .key.hovered {
        transform: scale(1.08);
        background: rgba(255, 255, 255, 0.24);
        border-color: #00f0ff;
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.5), inset 0 0 8px rgba(255, 255, 255, 0.4);
      }
      .key.key-wide {
        flex: 1.5;
        font-size: 13px;
        background: rgba(255, 255, 255, 0.05);
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
    this.host.style.pointerEvents = 'auto';
  }

  public close(): void {
    if (!this.host) return;
    this.isOpen = false;
    this.host.style.opacity = '0';
    this.host.style.transform = 'translateX(-50%) translateY(120%)';
    this.host.style.pointerEvents = 'none';
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
   * Updates hover styling based on cursor screen coordinates.
   */
  public updateHover(screenX: number, screenY: number): void {
    if (!this.isOpen || !this.shadow) return;

    const el = this.shadow.elementFromPoint(screenX, screenY);
    const keyEl = (el && el.classList.contains('key') ? el : el?.closest('.key')) as HTMLElement | null;

    if (keyEl === this.currentHoveredKey) return;

    this.clearHover();
    if (keyEl) {
      keyEl.classList.add('hovered');
      this.currentHoveredKey = keyEl;
    }
  }

  public clearHover(): void {
    if (this.currentHoveredKey) {
      this.currentHoveredKey.classList.remove('hovered');
      this.currentHoveredKey = null;
    }
  }

  /**
   * Executes key click if coordinates fall within keyboard bounds.
   * Returns true if event was consumed by the keyboard.
   */
  public handleClick(screenX: number, screenY: number): boolean {
    if (!this.isOpen || !this.shadow || !this.host) return false;

    // Check bounding rect of host panel
    const rect = this.host.getBoundingClientRect();
    if (
      screenX < rect.left ||
      screenX > rect.right ||
      screenY < rect.top ||
      screenY > rect.bottom
    ) {
      return false;
    }

    const el = this.shadow.elementFromPoint(screenX, screenY);
    const keyEl = (el && el.classList.contains('key') ? el : el?.closest('.key')) as HTMLElement | null;

    if (!keyEl) {
      return true; // Clicked inside keyboard panel background
    }

    const action = keyEl.dataset.action;
    const value = keyEl.dataset.val;

    playClickSound();

    if (action === 'CHAR' && value) {
      const charToType = this.isShift ? value.toUpperCase() : value.toLowerCase();
      typeCharacter(charToType);
    } else if (action === 'BACKSPACE') {
      backspaceCharacter();
    } else if (action === 'ENTER') {
      insertNewline();
    } else if (action === 'SPACE') {
      typeCharacter(' ');
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
    }

    return true;
  }

  /**
   * Renders the keyboard layout keys.
   */
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
      <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Pinch to type</div>
    `;
    this.containerEl.appendChild(header);

    // Layout Definitions
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
      r1El.appendChild(this.createCharKey(char));
    }
    this.containerEl.appendChild(r1El);

    // Row 2
    const r2El = document.createElement('div');
    r2El.className = 'keyboard-row';
    for (const char of row2) {
      r2El.appendChild(this.createCharKey(char));
    }
    this.containerEl.appendChild(r2El);

    // Row 3
    const r3El = document.createElement('div');
    r3El.className = 'keyboard-row';

    if (this.layer === 'ALPHA') {
      // Shift Key
      const shiftKey = document.createElement('div');
      shiftKey.className = `key key-wide ${this.isShift ? 'key-active' : ''}`;
      shiftKey.dataset.action = 'SHIFT';
      shiftKey.textContent = '⇧ Shift';
      r3El.appendChild(shiftKey);
    }

    for (const char of row3) {
      r3El.appendChild(this.createCharKey(char));
    }

    // Backspace Key
    const backspaceKey = document.createElement('div');
    backspaceKey.className = 'key key-wide';
    backspaceKey.dataset.action = 'BACKSPACE';
    backspaceKey.textContent = '⌫';
    r3El.appendChild(backspaceKey);

    this.containerEl.appendChild(r3El);

    // Row 4: Controls & Space
    const r4El = document.createElement('div');
    r4El.className = 'keyboard-row';

    // Layer Toggle (?123 / ABC)
    const layerKey = document.createElement('div');
    layerKey.className = 'key key-wide';
    layerKey.dataset.action = 'LAYER';
    layerKey.textContent = this.layer === 'ALPHA' ? '?123' : 'ABC';
    r4El.appendChild(layerKey);

    // Layout Toggle (AZERTY / QWERTY)
    const layoutKey = document.createElement('div');
    layoutKey.className = 'key key-wide';
    layoutKey.dataset.action = 'LAYOUT';
    layoutKey.textContent = this.layout;
    r4El.appendChild(layoutKey);

    // Space Key
    const spaceKey = document.createElement('div');
    spaceKey.className = 'key key-space';
    spaceKey.dataset.action = 'SPACE';
    spaceKey.textContent = 'Space';
    r4El.appendChild(spaceKey);

    // Enter Key
    const enterKey = document.createElement('div');
    enterKey.className = 'key key-wide';
    enterKey.dataset.action = 'ENTER';
    enterKey.textContent = '↵ Enter';
    r4El.appendChild(enterKey);

    // Close Key
    const closeKey = document.createElement('div');
    closeKey.className = 'key key-close';
    closeKey.dataset.action = 'CLOSE';
    closeKey.textContent = '✕';
    r4El.appendChild(closeKey);

    this.containerEl.appendChild(r4El);
  }

  private createCharKey(char: string): HTMLElement {
    const key = document.createElement('div');
    key.className = 'key';
    key.dataset.action = 'CHAR';
    key.dataset.val = char;
    key.textContent = this.isShift ? char.toUpperCase() : char.toLowerCase();
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
