/**
 * AirBrowse - Virtual Cursor, Dwell Progress Ring, and Toast Notification Overlay
 * Encapsulated inside an isolated Shadow DOM with pointer-events: none.
 *
 * Visual feedback states:
 * - MOVE: White dot
 * - PINCH_PENDING: Shrinking light cyan dot
 * - SCROLLING: Blue dot with halo glow
 * - Dwell hover: Circular SVG progress ring around cursor
 * - Small toast pills for completed actions
 */

import { RecognizerState } from '../core/gestures';

export class SpatialOverlay {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  // DOM Elements inside Shadow Root
  private cursorEl: HTMLElement | null = null;
  private dotEl: HTMLElement | null = null;
  private ringSvg: SVGSVGElement | null = null;
  private progressCircle: SVGCircleElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimeout: number | null = null;

  private isVisible = false;

  constructor() {
    this.initDOM();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById('airbrowse-overlay-host')) {
      return;
    }

    const host = document.createElement('div');
    host.id = 'airbrowse-overlay-host';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      overflow: 'hidden',
    });

    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        pointer-events: none;
      }
      .cursor-wrapper {
        position: fixed;
        top: 0;
        left: 0;
        width: 48px;
        height: 48px;
        margin-left: -24px;
        margin-top: -24px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
        will-change: transform;
      }
      .cursor-dot {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background-color: #ffffff;
        box-shadow: 0 0 12px rgba(255, 255, 255, 0.95), 0 0 24px rgba(0, 240, 255, 0.45);
        transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease, box-shadow 0.15s ease;
        box-sizing: border-box;
      }
      /* Pinch pending: shrinking dot */
      .cursor-dot.pinch-pending {
        transform: scale(0.48);
        background-color: #e0f2fe;
        box-shadow: 0 0 18px rgba(14, 165, 233, 0.95);
      }
      /* Scrolling: blue dot with active halo */
      .cursor-dot.scrolling {
        transform: scale(1.22);
        background-color: #3b82f6;
        box-shadow: 0 0 24px rgba(59, 130, 246, 0.95), 0 0 6px #ffffff;
      }

      /* Dwell Progress Ring SVG */
      .progress-ring {
        position: absolute;
        width: 44px;
        height: 44px;
        transform: rotate(-90deg);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.12s ease;
      }
      .progress-ring-bg {
        stroke: rgba(255, 255, 255, 0.15);
      }
      .progress-ring-fill {
        stroke-linecap: round;
        transition: stroke-dashoffset 0.05s linear;
      }

      /* Floating Toast Pill */
      .toast {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(-10px);
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 9999px;
        padding: 8px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 240, 255, 0.2);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .toast.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .toast-badge {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #00f0ff;
        box-shadow: 0 0 8px #00f0ff;
      }
    `;
    shadow.appendChild(style);

    // Cursor Wrapper
    const cursorWrapper = document.createElement('div');
    cursorWrapper.className = 'cursor-wrapper';

    // SVG Progress Ring
    const radius = 19;
    const circumference = 2 * Math.PI * radius;
    const ringSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ringSvg.setAttribute('class', 'progress-ring');
    ringSvg.setAttribute('viewBox', '0 0 44 44');

    const circleBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleBg.setAttribute('class', 'progress-ring-bg');
    circleBg.setAttribute('cx', '22');
    circleBg.setAttribute('cy', '22');
    circleBg.setAttribute('r', String(radius));
    circleBg.setAttribute('fill', 'transparent');
    circleBg.setAttribute('stroke-width', '3');

    const circleFill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleFill.setAttribute('class', 'progress-ring-fill');
    circleFill.setAttribute('cx', '22');
    circleFill.setAttribute('cy', '22');
    circleFill.setAttribute('r', String(radius));
    circleFill.setAttribute('fill', 'transparent');
    circleFill.setAttribute('stroke-width', '3');
    circleFill.setAttribute('stroke-dasharray', String(circumference));
    circleFill.setAttribute('stroke-dashoffset', String(circumference));
    circleFill.setAttribute('stroke', '#00f0ff');

    ringSvg.appendChild(circleBg);
    ringSvg.appendChild(circleFill);
    cursorWrapper.appendChild(ringSvg);

    // Core Dot
    const dot = document.createElement('div');
    dot.className = 'cursor-dot';
    cursorWrapper.appendChild(dot);

    shadow.appendChild(cursorWrapper);

    // Toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-badge"></span><span class="toast-text"></span>`;
    shadow.appendChild(toast);

    document.documentElement.appendChild(host);

    this.host = host;
    this.shadow = shadow;
    this.cursorEl = cursorWrapper;
    this.dotEl = dot;
    this.ringSvg = ringSvg;
    this.progressCircle = circleFill;
    this.toastEl = toast;
  }

  /**
   * Updates cursor position and morphing visual state:
   * White dot = MOVE
   * Shrinking dot = PINCH_PENDING
   * Blue dot = SCROLLING
   */
  public updateCursor(screenPxX: number, screenPxY: number, state: RecognizerState): void {
    if (!this.cursorEl || !this.dotEl) return;

    if (state === RecognizerState.IDLE) {
      this.hide();
      return;
    }

    if (!this.isVisible) {
      this.cursorEl.style.opacity = '1';
      this.isVisible = true;
    }

    this.cursorEl.style.transform = `translate3d(${screenPxX}px, ${screenPxY}px, 0)`;

    // State styling
    this.dotEl.className = 'cursor-dot';
    switch (state) {
      case RecognizerState.PINCH_PENDING:
        this.dotEl.classList.add('pinch-pending');
        break;
      case RecognizerState.SCROLLING:
        this.dotEl.classList.add('scrolling');
        break;
      case RecognizerState.MOVE:
      default:
        break;
    }
  }

  /**
   * Shows circular dwell progress ring around cursor.
   */
  public showDwellProgress(progress: number, isDangerous = false): void {
    if (!this.ringSvg || !this.progressCircle) return;

    if (progress <= 0) {
      this.cancelDwellProgress();
      return;
    }

    this.ringSvg.style.opacity = '1';

    const radius = 19;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(Math.max(progress, 0), 1);
    const offset = circumference - clamped * circumference;
    this.progressCircle.style.strokeDashoffset = String(offset);
    this.progressCircle.style.stroke = isDangerous ? '#ef4444' : '#00f0ff';
  }

  public cancelDwellProgress(): void {
    if (!this.ringSvg || !this.progressCircle) return;
    this.ringSvg.style.opacity = '0';
    const radius = 19;
    const circumference = 2 * Math.PI * radius;
    this.progressCircle.style.strokeDashoffset = String(circumference);
  }

  /**
   * Displays small toast notification at top center.
   */
  public showToast(message: string, durationMs = 1500): void {
    if (!this.toastEl) return;

    const textEl = this.toastEl.querySelector('.toast-text');
    if (textEl) {
      textEl.textContent = message;
    }

    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    this.toastEl.classList.add('visible');
    this.toastTimeout = window.setTimeout(() => {
      if (this.toastEl) {
        this.toastEl.classList.remove('visible');
      }
      this.toastTimeout = null;
    }, durationMs);
  }

  public hide(): void {
    if (this.cursorEl && this.isVisible) {
      this.cursorEl.style.opacity = '0';
      this.isVisible = false;
      this.cancelDwellProgress();
    }
  }

  public destroy(): void {
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.cursorEl = null;
      this.dotEl = null;
      this.ringSvg = null;
      this.progressCircle = null;
      this.toastEl = null;
    }
  }
}
