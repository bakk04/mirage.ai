/**
 * AirBrowse - On-Screen Floating Toolbar (Shadow DOM)
 * High-contrast, auto-collapsible vertical bar docked to the right edge.
 * Large buttons (min 64px) with SVG icons and labels:
 * Back, Forward, Refresh, Scroll Up, Scroll Down, Zoom +, Zoom -, New Tab, Close Tab, Keyboard.
 *
 * Dwell activation: 1000 ms hover with circular progress ring and scale expansion.
 * Dangerous action (Close Tab): 1500 ms dwell requirement.
 * Quick pinch click support. 800 ms post-activation cooldown.
 * Pointer-events isolated: only virtual cursor hit-testing activates buttons.
 */

import { GESTURE_CONFIG } from '../core/math';

export type ToolbarAction =
  | 'BACK'
  | 'FORWARD'
  | 'REFRESH'
  | 'SCROLL_UP'
  | 'SCROLL_DOWN'
  | 'ZOOM_IN'
  | 'ZOOM_OUT'
  | 'NEW_TAB'
  | 'CLOSE_TAB'
  | 'KEYBOARD';

export interface ToolbarButtonConfig {
  id: ToolbarAction;
  label: string;
  isDangerous?: boolean;
  svgIcon: string;
}

const BUTTON_CONFIGS: ToolbarButtonConfig[] = [
  {
    id: 'BACK',
    label: 'Back',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  },
  {
    id: 'FORWARD',
    label: 'Forward',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
  },
  {
    id: 'REFRESH',
    label: 'Refresh',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  },
  {
    id: 'SCROLL_UP',
    label: 'Page Up',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  },
  {
    id: 'SCROLL_DOWN',
    label: 'Page Down',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  },
  {
    id: 'ZOOM_IN',
    label: 'Zoom +',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  },
  {
    id: 'ZOOM_OUT',
    label: 'Zoom -',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  },
  {
    id: 'NEW_TAB',
    label: 'New Tab',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  },
  {
    id: 'CLOSE_TAB',
    label: 'Close Tab',
    isDangerous: true,
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  },
  {
    id: 'KEYBOARD',
    label: 'Keyboard',
    svgIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M6 12h.001M18 12h.001M8 16h8"/></svg>',
  },
];

export interface ToolbarResult {
  consumed: boolean;
  actionTriggered?: ToolbarAction;
  dwellProgress?: number;
}

export class ToolbarUI {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private containerEl: HTMLElement | null = null;
  private buttonElements: Map<ToolbarAction, HTMLElement> = new Map();
  private progressCircles: Map<ToolbarAction, SVGCircleElement> = new Map();

  // Dwell state
  private currentlyHoveredAction: ToolbarAction | null = null;
  private dwellStartTime = 0;
  private lastActivationTime = -Infinity;

  // Auto-collapse state
  private isCollapsed = false;

  private onActionCallback?: (action: ToolbarAction) => void;

  constructor(options: { onAction?: (action: ToolbarAction) => void } = {}) {
    this.onActionCallback = options.onAction;
    this.initDOM();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') {
      const createStub = () => ({
        classList: {
          add: () => {},
          remove: () => {},
          contains: () => false,
        },
        getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }),
        querySelector: () => null,
        remove: () => {},
      } as unknown as HTMLElement);

      this.host = createStub();
      this.containerEl = createStub();
      for (const cfg of BUTTON_CONFIGS) {
        this.buttonElements.set(cfg.id, createStub());
      }
      return;
    }
    if (document.getElementById('airbrowse-toolbar-host')) return;

    const host = document.createElement('div');
    host.id = 'airbrowse-toolbar-host';
    Object.assign(host.style, {
      position: 'fixed',
      top: '50%',
      right: '8px',
      transform: 'translateY(-50%)',
      zIndex: '2147483646',
      pointerEvents: 'none',
      visibility: 'hidden',
      opacity: '0',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    });

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      .toolbar-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px 6px;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.22);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border-radius: 20px;
        box-shadow: 0 16px 40px -6px rgba(0, 0, 0, 0.65), 0 0 20px rgba(0, 240, 255, 0.15);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
        max-height: 94vh;
        overflow-y: auto;
        scrollbar-width: none;
      }
      .toolbar-container::-webkit-scrollbar {
        display: none;
      }
      .toolbar-container.collapsed {
        transform: translateX(calc(100% - 14px));
        opacity: 0.85;
      }
      .toolbar-btn {
        position: relative;
        width: 64px;
        height: 64px;
        min-width: 64px;
        min-height: 64px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 16px;
        color: #ffffff;
        cursor: pointer;
        box-sizing: border-box;
        transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .toolbar-btn.hovered {
        transform: scale(1.08);
        background: rgba(255, 255, 255, 0.22);
        border-color: #00f0ff;
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.5);
      }
      .toolbar-btn.dangerous {
        border-color: rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.14);
      }
      .toolbar-btn.dangerous.hovered {
        border-color: #ef4444;
        background: rgba(239, 68, 68, 0.32);
        box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
      }
      .btn-icon {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .btn-icon svg {
        width: 22px;
        height: 22px;
      }
      .btn-label {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: -0.01em;
        text-align: center;
        color: rgba(255, 255, 255, 0.9);
        white-space: nowrap;
      }
      .dwell-ring {
        position: absolute;
        inset: -2px;
        width: calc(100% + 4px);
        height: calc(100% + 4px);
        pointer-events: none;
        transform: rotate(-90deg);
        opacity: 0;
        transition: opacity 0.1s ease;
      }
      .dwell-ring-circle {
        stroke-linecap: round;
        transition: stroke-dashoffset 0.05s linear;
      }
      .collapse-handle {
        position: absolute;
        left: -8px;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
        height: 32px;
        background: rgba(0, 240, 255, 0.7);
        border-radius: 9999px;
        box-shadow: 0 0 8px rgba(0, 240, 255, 0.9);
      }
    `;
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'toolbar-container';

    // Handle visible in collapsed mode
    const handle = document.createElement('div');
    handle.className = 'collapse-handle';
    container.appendChild(handle);

    for (const cfg of BUTTON_CONFIGS) {
      const btn = document.createElement('div');
      btn.className = `toolbar-btn ${cfg.isDangerous ? 'dangerous' : ''}`;
      btn.dataset.action = cfg.id;

      // SVG Dwell Progress Ring
      const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ringSvg.setAttribute('class', 'dwell-ring');
      ringSvg.setAttribute('viewBox', '0 0 68 68');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('class', 'dwell-ring-circle');
      circle.setAttribute('cx', '34');
      circle.setAttribute('cy', '34');
      circle.setAttribute('r', '31');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '3');
      circle.setAttribute('stroke', cfg.isDangerous ? '#ef4444' : '#00f0ff');

      const circumference = 2 * Math.PI * 31;
      circle.setAttribute('stroke-dasharray', String(circumference));
      circle.setAttribute('stroke-dashoffset', String(circumference));

      ringSvg.appendChild(circle);
      btn.appendChild(ringSvg);

      // Icon
      const iconWrap = document.createElement('div');
      iconWrap.className = 'btn-icon';
      iconWrap.innerHTML = cfg.svgIcon;
      btn.appendChild(iconWrap);

      // Label
      const labelEl = document.createElement('div');
      labelEl.className = 'btn-label';
      labelEl.textContent = cfg.label;
      btn.appendChild(labelEl);

      container.appendChild(btn);
      this.buttonElements.set(cfg.id, btn);
      this.progressCircles.set(cfg.id, circle);
    }

    shadow.appendChild(container);
    document.documentElement.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.containerEl = container;
  }

  /**
   * Evaluates cursor position for auto-collapse and dwell activation.
   * Returns whether the cursor was over the toolbar and any triggered action.
   */
  public updateCursor(
    screenX: number,
    screenY: number,
    timestamp: number = performance.now()
  ): ToolbarResult {
    if (!this.containerEl || !this.host) {
      return { consumed: false };
    }

    // Auto-collapse logic: expand when cursor is near right edge (within 130px)
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
    const isNearRightEdge = screenX >= windowWidth - 130;

    if (isNearRightEdge && this.isCollapsed) {
      this.isCollapsed = false;
      this.containerEl.classList.remove('collapsed');
    } else if (!isNearRightEdge && !this.isCollapsed) {
      this.isCollapsed = true;
      this.containerEl.classList.add('collapsed');
    }

    // Hit-testing against toolbar container
    const containerRect = this.containerEl.getBoundingClientRect();
    const isInsideContainer =
      screenX >= containerRect.left &&
      screenX <= containerRect.right &&
      screenY >= containerRect.top &&
      screenY <= containerRect.bottom;

    if (!isInsideContainer) {
      this.clearHover();
      return { consumed: false };
    }

    // Inside toolbar container: check which button is hovered
    let hitAction: ToolbarAction | null = null;
    for (const [action, btn] of this.buttonElements.entries()) {
      const rect = btn.getBoundingClientRect();
      if (
        screenX >= rect.left &&
        screenX <= rect.right &&
        screenY >= rect.top &&
        screenY <= rect.bottom
      ) {
        hitAction = action;
        break;
      }
    }

    if (!hitAction) {
      this.clearHover();
      return { consumed: true };
    }

    // If cooldown is active (800 ms lockout), dwell cannot progress
    if (timestamp - this.lastActivationTime < GESTURE_CONFIG.actionCooldownMs) {
      return { consumed: true };
    }

    // Button entered or maintained
    if (hitAction !== this.currentlyHoveredAction) {
      this.clearHover();
      this.currentlyHoveredAction = hitAction;
      this.dwellStartTime = timestamp;
      const btn = this.buttonElements.get(hitAction);
      btn?.classList.add('hovered');
      const ring = btn?.querySelector('.dwell-ring') as HTMLElement | null;
      if (ring) ring.style.opacity = '1';
    }

    // Dwell progress calculation
    const cfg = BUTTON_CONFIGS.find((b) => b.id === hitAction);
    const requiredDwell = cfg?.isDangerous
      ? GESTURE_CONFIG.dwellDangerousMs
      : GESTURE_CONFIG.dwellStandardMs;

    const elapsed = timestamp - this.dwellStartTime;
    const progress = Math.min(Math.max(elapsed / requiredDwell, 0), 1.0);

    // Update progress ring SVG
    const circle = this.progressCircles.get(hitAction);
    if (circle) {
      const radius = 31;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - progress * circumference;
      circle.style.strokeDashoffset = String(offset);
    }

    // Dwell complete: activate action!
    if (progress >= 1.0) {
      const activatedAction = hitAction;
      this.lastActivationTime = timestamp;
      this.clearHover();
      this.executeAction(activatedAction);
      return { consumed: true, actionTriggered: activatedAction, dwellProgress: 1.0 };
    }

    return { consumed: true, dwellProgress: progress };
  }

  /** Shows the controls only while gesture control is actively running. */
  public setVisible(visible: boolean): void {
    if (!this.host) return;
    this.host.style.visibility = visible ? 'visible' : 'hidden';
    this.host.style.opacity = visible ? '1' : '0';
    if (!visible) this.clearHover();
  }

  /**
   * Handles quick pinch click on toolbar buttons.
   */
  public handleClick(
    screenX: number,
    screenY: number,
    timestamp: number = performance.now()
  ): boolean {
    if (!this.containerEl || !this.host) return false;

    // Check cooldown
    if (timestamp - this.lastActivationTime < GESTURE_CONFIG.actionCooldownMs) {
      return false;
    }

    const containerRect = this.containerEl.getBoundingClientRect();
    if (
      screenX < containerRect.left ||
      screenX > containerRect.right ||
      screenY < containerRect.top ||
      screenY > containerRect.bottom
    ) {
      return false;
    }

    for (const [action, btn] of this.buttonElements.entries()) {
      const rect = btn.getBoundingClientRect();
      if (
        screenX >= rect.left &&
        screenX <= rect.right &&
        screenY >= rect.top &&
        screenY <= rect.bottom
      ) {
        this.lastActivationTime = timestamp;
        this.clearHover();
        this.executeAction(action);
        return true;
      }
    }

    return true; // Click consumed inside toolbar container
  }

  public clearHover(): void {
    if (this.currentlyHoveredAction) {
      const btn = this.buttonElements.get(this.currentlyHoveredAction);
      btn?.classList.remove('hovered');
      const ring = btn?.querySelector('.dwell-ring') as HTMLElement | null;
      if (ring) ring.style.opacity = '0';

      const circle = this.progressCircles.get(this.currentlyHoveredAction);
      if (circle) {
        const circumference = 2 * Math.PI * 31;
        circle.style.strokeDashoffset = String(circumference);
      }

      this.currentlyHoveredAction = null;
      this.dwellStartTime = 0;
    }
  }

  private executeAction(action: ToolbarAction): void {
    if (this.onActionCallback) {
      this.onActionCallback(action);
      return;
    }

    // Default implementations
    switch (action) {
      case 'BACK':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'GO_BACK' });
        } else if (typeof window !== 'undefined') {
          window.history.back();
        }
        break;

      case 'FORWARD':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'GO_FORWARD' });
        } else if (typeof window !== 'undefined') {
          window.history.forward();
        }
        break;

      case 'REFRESH':
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
        break;

      case 'SCROLL_UP':
        if (typeof window !== 'undefined') {
          window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
        }
        break;

      case 'SCROLL_DOWN':
        if (typeof window !== 'undefined') {
          window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
        }
        break;

      case 'ZOOM_IN':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'ZOOM', delta: 0.1 });
        }
        break;

      case 'ZOOM_OUT':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'ZOOM', delta: -0.1 });
        }
        break;

      case 'NEW_TAB':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'NEW_TAB' });
        }
        break;

      case 'CLOSE_TAB':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
        }
        break;

      case 'KEYBOARD':
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('airbrowse:toggle-keyboard'));
        }
        break;
    }
  }

  public destroy(): void {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.containerEl = null;
      this.buttonElements.clear();
      this.progressCircles.clear();
    }
  }
}
