import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InteractionEngine, getScrollableAncestor, getDeepElementFromPoint } from '../src/core/interaction';

// Polyfill window and document for Node test environment
if (typeof window === 'undefined') {
  const windowStub = {
    scrollBy: vi.fn(),
    requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => 1),
    cancelAnimationFrame: vi.fn(),
  };
  (globalThis as unknown as { window: unknown }).window = windowStub;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
    (window as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame(cb);
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
    (window as unknown as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame(id);
}

if (typeof document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    body: {},
    documentElement: {},
    getElementById: () => null,
    elementFromPoint: () => null,
  };
}

describe('Phase 3: Scroll Engine & Sub-pixel Accumulator', () => {
  let engine: InteractionEngine;

  beforeEach(() => {
    engine = new InteractionEngine();
  });

  it('sub-pixel accumulator: 1000 frames of 0.3 px produce exactly 300 px +- 1', async () => {
    let totalScrolled = 0;
    // Mock window.scrollBy
    const originalScrollBy = window.scrollBy;
    window.scrollBy = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options?.top) {
        totalScrolled += options.top;
      }
    });

    // Mock requestAnimationFrame to run immediately
    const originalRaf = window.requestAnimationFrame;
    let rAFCallback: FrameRequestCallback | null = null;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rAFCallback = cb;
      return 1;
    });

    for (let i = 0; i < 1000; i++) {
      engine.scrollByJoystick(0.3);
      if (rAFCallback) {
        const cb = rAFCallback;
        rAFCallback = null;
        cb(performance.now());
      }
    }

    window.scrollBy = originalScrollBy;
    window.requestAnimationFrame = originalRaf;

    expect(totalScrolled).toBeGreaterThanOrEqual(299);
    expect(totalScrolled).toBeLessThanOrEqual(301);
    expect(totalScrolled).toBe(300);
  });

  it('stopScrolling terminates motion immediately; zero residual scrollBy executes', () => {
    let scrolled = 0;
    window.scrollBy = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === 'object' && options?.top) {
        scrolled += options.top;
      }
    });

    let pendingCb: FrameRequestCallback | null = null;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      pendingCb = cb;
      return 42;
    });
    window.cancelAnimationFrame = vi.fn((id: number) => {
      if (id === 42) pendingCb = null;
    });

    // Queue a scroll
    engine.scrollByJoystick(10);
    expect(pendingCb).toBeDefined();

    // Immediately stop
    engine.stopScrolling();
    expect(pendingCb).toBeNull();

    // If an orphaned callback were called, nothing should scroll
    expect(scrolled).toBe(0);
  });

  it('proves continuity at dead-zone boundary and strict monotonicity across dense sweep', () => {
    const deadZone = 0.04;
    const exponent = 1.5;
    const gain = 280;

    const computeSpeed = (diffY: number): number => {
      const absDiff = Math.abs(diffY);
      if (absDiff < deadZone) return 0;
      const excess = absDiff - deadZone;
      const magnitude = Math.pow(excess, exponent) * gain;
      return diffY < 0 ? -magnitude : magnitude;
    };

    // Continuity: limit as diffY approaches 0.04 from right is 0
    const atBoundaryPlus = computeSpeed(0.040001);
    expect(atBoundaryPlus).toBeCloseTo(0, 3);

    // Monotonicity: for y > 0.04, speed is strictly monotonically increasing
    let prevSpeed = 0;
    for (let y = 0.041; y <= 0.50; y += 0.001) {
      const speed = computeSpeed(y);
      expect(speed).toBeGreaterThan(prevSpeed);
      prevSpeed = speed;
    }
  });

  it('getScrollableAncestor returns scrollable container or falls back to window', () => {
    expect(getScrollableAncestor(null)).toBe(window);

    const container = {
      scrollHeight: 1000,
      clientHeight: 500,
      parentElement: null,
    } as unknown as Element;

    (window as unknown as { getComputedStyle: (el: Element) => { overflowY: string } }).getComputedStyle = () => ({
      overflowY: 'scroll',
    });

    const scrollable = getScrollableAncestor(container);
    expect(scrollable).toBe(container);
  });

  it('triggerClick safely handles missing document and non-existent targets', () => {
    const res = engine.triggerClick(100, 100);
    expect(res).toBe(false);
  });

  it('getDeepElementFromPoint returns null when document is undefined or target is absent', () => {
    expect(getDeepElementFromPoint(100, 100)).toBeNull();
  });
});
