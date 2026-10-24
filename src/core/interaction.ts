/**
 * AirBrowse - DOM Interaction Engine
 * Handles precision DOM manipulations decoupled via requestAnimationFrame:
 * - Natural joystick-rate vertical scrolling batched to nearest scrollable container
 * - Instantaneous stop on SCROLL_END with zero residual momentum
 * - Synthetic click dispatch sequence (pointerdown/mousedown/focus/pointerup/mouseup/click)
 * - Editable input detection with automatic virtual keyboard activation
 * - getDeepElementFromPoint bypassing extension overlays
 */

import { playClickSound } from './audio';

export interface InteractionEngineConfig {
  enableVisualFeedback?: boolean;
}

/**
 * Resolves the deeply hovered element across shadow roots, ignoring extension overlays.
 */
export function getDeepElementFromPoint(x: number, y: number): Element | null {
  if (typeof document === 'undefined') return null;

  // Temporarily disable overlay pointer events to ensure correct hit-testing
  const overlayHost = document.getElementById('airbrowse-overlay-host');
  const toolbarHost = document.getElementById('airbrowse-toolbar-host');
  const keyboardHost = document.getElementById('airbrowse-keyboard-host');

  const prevOverlay = overlayHost ? overlayHost.style.pointerEvents : '';
  const prevToolbar = toolbarHost ? toolbarHost.style.pointerEvents : '';
  const prevKeyboard = keyboardHost ? keyboardHost.style.pointerEvents : '';

  if (overlayHost) overlayHost.style.pointerEvents = 'none';
  if (toolbarHost) toolbarHost.style.pointerEvents = 'none';
  if (keyboardHost) keyboardHost.style.pointerEvents = 'none';

  try {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  } finally {
    if (overlayHost) overlayHost.style.pointerEvents = prevOverlay;
    if (toolbarHost) toolbarHost.style.pointerEvents = prevToolbar;
    if (keyboardHost) keyboardHost.style.pointerEvents = prevKeyboard;
  }
}

/**
 * Traverses up the DOM tree from target element to identify the nearest scrollable ancestor.
 * Falls back to window if no scrollable container exists.
 */
export function getScrollableAncestor(el: Element | null): Element | Window {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return (typeof window !== 'undefined' ? window : null) as unknown as Window;
  }

  let current = el;
  while (current && current !== document.body && current !== document.documentElement) {
    try {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      const isScrollable =
        (overflowY === 'auto' || overflowY === 'scroll') &&
        current.scrollHeight > current.clientHeight;

      if (isScrollable) {
        return current;
      }
    } catch {
      break;
    }
    current = current.parentElement;
  }
  return window;
}

export class InteractionEngine {
  private readonly enableVisualFeedback: boolean;

  // Scroll state
  private pendingScrollPx = 0;
  private scrollRafId: number | null = null;
  private scrollVelocity = 0;
  private lastScrollFrameTime: number | null = null;
  private activeScrollTarget: Element | Window | null = typeof window !== 'undefined' ? window : null;

  constructor(config: InteractionEngineConfig = {}) {
    this.enableVisualFeedback = config.enableVisualFeedback ?? true;
  }

  /**
   * Joystick rate scroll per frame (in pixels).
   * Positive speed = page moves down (scroll down).
   * Negative speed = page moves up (scroll up).
   * Accumulates sub-pixel remainders so fractional speeds are never dropped.
   */
  public scrollByJoystick(
    speed: number,
    cursorX?: number,
    cursorY?: number,
    sourceFrameMs?: number
  ): void {
    if (!Number.isFinite(speed) || Math.abs(speed) < 0.001) return;
    if (typeof window === 'undefined') return;

    if (cursorX !== undefined && cursorY !== undefined) {
      const el = getDeepElementFromPoint(cursorX, cursorY);
      this.activeScrollTarget = getScrollableAncestor(el);
    }

    if (sourceFrameMs !== undefined && sourceFrameMs > 0) {
      this.scrollVelocity = speed / (sourceFrameMs / 1000);
      if (this.scrollRafId === null) {
        this.lastScrollFrameTime = null;
        this.scrollRafId = requestAnimationFrame(this.flushSmoothScroll);
      }
      return;
    }

    this.pendingScrollPx += speed;
    if (this.scrollRafId === null) {
      this.scrollRafId = requestAnimationFrame(() => {
        const total = this.pendingScrollPx;
        const intScroll = Math.trunc(total + (total >= 0 ? 1e-9 : -1e-9));
        this.pendingScrollPx = total - intScroll;
        this.scrollRafId = null;

        if (intScroll !== 0) {
          const target = this.activeScrollTarget ?? (typeof window !== 'undefined' ? window : null);
          if (typeof window !== 'undefined' && target === window) {
            window.scrollBy({ top: intScroll, behavior: 'auto' });
          } else if (target && 'scrollBy' in target) {
            (target as Element).scrollBy({ top: intScroll, behavior: 'auto' });
          }
        }
      });
    }
  }

  /**
   * Immediately terminates all ongoing scroll operations with ZERO residual momentum.
   * Flushes sub-pixel remainder and cancels pending animation frame.
   */
  public stopScrolling(): void {
    this.pendingScrollPx = 0;
    this.scrollVelocity = 0;
    this.lastScrollFrameTime = null;
    if (this.scrollRafId !== null) {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.scrollRafId);
      } else if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.scrollRafId);
      }
      this.scrollRafId = null;
    }
  }

  private readonly flushSmoothScroll = (timestamp: number): void => {
    if (this.scrollVelocity === 0 || typeof window === 'undefined') {
      this.scrollRafId = null;
      this.lastScrollFrameTime = null;
      return;
    }

    const previous = this.lastScrollFrameTime ?? timestamp;
    const elapsedMs = Math.min(Math.max(timestamp - previous, 1), 50);
    this.lastScrollFrameTime = timestamp;
    const pixels = this.scrollVelocity * (elapsedMs / 1000);
    const intScroll = Math.trunc(pixels + (pixels >= 0 ? 1e-9 : -1e-9));
    this.pendingScrollPx += pixels - intScroll;
    const remainderScroll = Math.trunc(
      this.pendingScrollPx + (this.pendingScrollPx >= 0 ? 1e-9 : -1e-9)
    );
    this.pendingScrollPx -= remainderScroll;

    if (intScroll + remainderScroll !== 0) {
      const total = intScroll + remainderScroll;
      const target = this.activeScrollTarget ?? window;
      if (target === window) {
        window.scrollBy({ top: total, behavior: 'auto' });
      } else if ('scrollBy' in target) {
        target.scrollBy({ top: total, behavior: 'auto' });
      }
    }
    this.scrollRafId = requestAnimationFrame(this.flushSmoothScroll);
  };

  /**
   * Synthetic click sequence: pointerdown -> mousedown -> focus -> pointerup -> mouseup -> click.
   * Auto-activates virtual keyboard if target is editable.
   */
  public triggerClick(x: number, y: number, onEditableFocus?: () => void): boolean {
    if (typeof document === 'undefined') return false;

    const target = getDeepElementFromPoint(x, y);
    if (!target) return false;

    playClickSound();

    if (this.enableVisualFeedback) {
      this.spawnClickRipple(x, y);
    }

    const baseEventInit: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    };

    const mouseEventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      button: 0,
      buttons: 1,
    };

    try {
      target.dispatchEvent(new PointerEvent('pointerdown', baseEventInit));
      target.dispatchEvent(new MouseEvent('mousedown', mouseEventInit));

      if (target instanceof HTMLElement && typeof target.focus === 'function') {
        target.focus();
      }

      const releasePointerInit: PointerEventInit = { ...baseEventInit, buttons: 0 };
      const releaseMouseInit: MouseEventInit = { ...mouseEventInit, buttons: 0 };

      target.dispatchEvent(new PointerEvent('pointerup', releasePointerInit));
      target.dispatchEvent(new MouseEvent('mouseup', releaseMouseInit));
      target.dispatchEvent(new MouseEvent('click', releaseMouseInit));

      // Check if target is an editable field
      const isEditable =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement &&
          !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'color', 'range'].includes(
            target.type
          )) ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isEditable) {
        if (onEditableFocus) {
          onEditableFocus();
        }
      }

      return true;
    } catch (err) {
      console.warn('[AirBrowse] Click interaction recovered safely:', err);
      return false;
    }
  }

  /**
   * Spawns click ripple visual feedback.
   */
  private spawnClickRipple(x: number, y: number): void {
    if (typeof document === 'undefined') return;

    const ripple = document.createElement('div');
    ripple.setAttribute('aria-hidden', 'true');
    Object.assign(ripple.style, {
      position: 'fixed',
      top: `${y}px`,
      left: `${x}px`,
      width: '16px',
      height: '16px',
      marginLeft: '-8px',
      marginTop: '-8px',
      borderRadius: '50%',
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      border: '2px solid #ffffff',
      boxShadow: '0 0 16px rgba(0, 240, 255, 0.9), inset 0 0 8px rgba(255, 255, 255, 0.9)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transform: 'scale(1)',
      opacity: '1',
      transition: 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease-out',
      willChange: 'transform, opacity',
    });

    document.documentElement.appendChild(ripple);
    requestAnimationFrame(() => {
      ripple.style.transform = 'scale(4.0)';
      ripple.style.opacity = '0';
    });

    setTimeout(() => {
      ripple.remove();
    }, 380);
  }
}
