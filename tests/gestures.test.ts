import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GestureRecognizer, RecognizerState, GestureEvent } from '../src/core/gestures';
import { LANDMARK_INDEX, Point3D, GESTURE_CONFIG } from '../src/core/math';
import { ToolbarUI } from '../src/ui/Toolbar';

/**
 * Helper to build a 21-landmark synthetic hand with standard biomechanical positions.
 */
function createSyntheticHand(
  overrides: Partial<Record<number, { x: number; y: number; z?: number }>> = {}
): Point3D[] {
  const landmarks: Point3D[] = [
    { x: 0.50, y: 0.80, z: 0 }, // 0: WRIST
    { x: 0.42, y: 0.72, z: 0 }, // 1: THUMB_CMC
    { x: 0.36, y: 0.65, z: 0 }, // 2: THUMB_MCP
    { x: 0.32, y: 0.58, z: 0 }, // 3: THUMB_IP
    { x: 0.28, y: 0.52, z: 0 }, // 4: THUMB_TIP
    { x: 0.44, y: 0.55, z: 0 }, // 5: INDEX_MCP
    { x: 0.43, y: 0.45, z: 0 }, // 6: INDEX_PIP
    { x: 0.42, y: 0.38, z: 0 }, // 7: INDEX_DIP
    { x: 0.42, y: 0.30, z: 0 }, // 8: INDEX_TIP
    { x: 0.50, y: 0.50, z: 0 }, // 9: MIDDLE_MCP (scale = dist(0, 9) = 0.30)
    { x: 0.50, y: 0.40, z: 0 }, // 10: MIDDLE_PIP
    { x: 0.50, y: 0.32, z: 0 }, // 11: MIDDLE_DIP
    { x: 0.50, y: 0.24, z: 0 }, // 12: MIDDLE_TIP
    { x: 0.56, y: 0.55, z: 0 }, // 13: RING_MCP
    { x: 0.57, y: 0.45, z: 0 }, // 14: RING_PIP
    { x: 0.58, y: 0.38, z: 0 }, // 15: RING_DIP
    { x: 0.58, y: 0.30, z: 0 }, // 16: RING_TIP
    { x: 0.62, y: 0.60, z: 0 }, // 17: PINKY_MCP
    { x: 0.64, y: 0.52, z: 0 }, // 18: PINKY_PIP
    { x: 0.65, y: 0.46, z: 0 }, // 19: PINKY_DIP
    { x: 0.66, y: 0.40, z: 0 }, // 20: PINKY_TIP
  ];

  for (const [idxStr, point] of Object.entries(overrides)) {
    const idx = Number(idxStr);
    landmarks[idx] = { ...landmarks[idx], ...point };
  }

  return landmarks;
}

/**
 * Helper to build a Peace Sign hand:
 * - Index extended: tip is farther from wrist than PIP
 * - Middle extended: tip is farther from wrist than PIP
 * - Ring curled: tip is closer to wrist than PIP
 * - Pinky curled: tip is closer to wrist than PIP
 * - Thumb ignored
 */
function createPeaceSignHand(palmY = 0.50): Point3D[] {
  const wristY = palmY + 0.30;
  return createSyntheticHand({
    [LANDMARK_INDEX.WRIST]: { x: 0.50, y: wristY },
    [LANDMARK_INDEX.MIDDLE_MCP]: { x: 0.50, y: palmY }, // handScale = 0.30

    // Index extended: tip farther from wrist than PIP
    [LANDMARK_INDEX.INDEX_MCP]: { x: 0.44, y: palmY + 0.05 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.44, y: palmY - 0.05 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.44, y: palmY - 0.20 },

    // Middle extended: tip farther from wrist than PIP
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: palmY - 0.05 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: palmY - 0.22 },

    // Ring curled: tip closer to wrist than PIP
    [LANDMARK_INDEX.RING_MCP]: { x: 0.56, y: palmY + 0.05 },
    [LANDMARK_INDEX.RING_PIP]: { x: 0.56, y: palmY - 0.05 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.56, y: palmY + 0.10 },

    // Pinky curled: tip closer to wrist than PIP
    [LANDMARK_INDEX.PINKY_MCP]: { x: 0.62, y: palmY + 0.08 },
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.62, y: palmY - 0.02 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.62, y: palmY + 0.12 },
  });
}

describe('3-Gesture System Suite', () => {
  let recognizer: GestureRecognizer;

  beforeEach(() => {
    recognizer = new GestureRecognizer();
  });

  it('quick pinch = 1 click', () => {
    const allEvents: GestureEvent[] = [];

    // 1. Initial hover frame at t=0
    allEvents.push(...recognizer.update(createSyntheticHand(), 0));
    expect(recognizer.getCurrentState()).toBe(RecognizerState.MOVE);

    // 2. Pinch starts: move thumb tip (4) close to index tip (8)
    // distance = 0.01 / scale 0.30 = 0.033 <= 0.25
    const pinchedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.42, y: 0.31 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });

    // 3 stable frames to enter pinch
    allEvents.push(...recognizer.update(pinchedHand, 30));
    allEvents.push(...recognizer.update(pinchedHand, 60));
    allEvents.push(...recognizer.update(pinchedHand, 90));

    expect(recognizer.getCurrentState()).toBe(RecognizerState.PINCH_PENDING);

    // 3. Quick release at t=180 (< 350 ms duration from entry at 90ms)
    const releasedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.28, y: 0.52 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });
    allEvents.push(...recognizer.update(releasedHand, 180));

    const clicks = allEvents.filter((e) => e.type === 'CLICK');
    const scrolls = allEvents.filter((e) => e.type === 'SCROLL_DELTA');

    expect(clicks.length).toBe(1);
    expect(scrolls.length).toBe(0);
    expect(recognizer.getCurrentState()).toBe(RecognizerState.MOVE);
  });

  it('long pinch = 0 clicks', () => {
    const allEvents: GestureEvent[] = [];

    const pinchedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.42, y: 0.31 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });

    // Enter pinch at t=90
    allEvents.push(...recognizer.update(pinchedHand, 30));
    allEvents.push(...recognizer.update(pinchedHand, 60));
    allEvents.push(...recognizer.update(pinchedHand, 90));
    expect(recognizer.getCurrentState()).toBe(RecognizerState.PINCH_PENDING);

    // Hold still beyond 350 ms: elapsed at t=500 is 500 - 90 = 410 ms (> 350 ms)
    allEvents.push(...recognizer.update(pinchedHand, 200));
    allEvents.push(...recognizer.update(pinchedHand, 350));
    allEvents.push(...recognizer.update(pinchedHand, 500));

    // Release at t=550
    const releasedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.28, y: 0.52 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });
    allEvents.push(...recognizer.update(releasedHand, 550));

    const clicks = allEvents.filter((e) => e.type === 'CLICK');
    expect(clicks.length).toBe(0);
    expect(recognizer.getCurrentState()).toBe(RecognizerState.MOVE);
  });

  it('three stable fingers produce one refresh command and re-arm after release', () => {
    const threeFingerHand = createSyntheticHand({
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.20 },
      [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: 0.18 },
      [LANDMARK_INDEX.RING_TIP]: { x: 0.58, y: 0.20 },
      [LANDMARK_INDEX.PINKY_TIP]: { x: 0.62, y: 0.68 },
    });

    const events: GestureEvent[] = [];
    events.push(...recognizer.update(threeFingerHand, 0));
    events.push(...recognizer.update(threeFingerHand, 30));
    events.push(...recognizer.update(threeFingerHand, 60));

    expect(events.filter((event) => event.type === 'COMMAND')).toEqual([
      { type: 'COMMAND', command: 'REFRESH' },
    ]);
  });

  it('cooldown prevents a second rapid pinch click', () => {
    const pinchedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.42, y: 0.31 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });
    const releasedHand = createSyntheticHand({
      [LANDMARK_INDEX.THUMB_TIP]: { x: 0.28, y: 0.52 },
      [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
    });
    const events: GestureEvent[] = [];

    const pinch = (start: number) => {
      events.push(...recognizer.update(pinchedHand, start));
      events.push(...recognizer.update(pinchedHand, start + 30));
      events.push(...recognizer.update(pinchedHand, start + 60));
      events.push(...recognizer.update(releasedHand, start + 120));
    };

    pinch(0);
    pinch(200);
    expect(events.filter((event) => event.type === 'CLICK')).toHaveLength(1);
  });

  it('peace sign + hand up = scroll up, 0 clicks', () => {
    const allEvents: GestureEvent[] = [];

    // Initial Peace sign hand at neutral Y=0.50
    const peaceNeutral = createPeaceSignHand(0.50);

    // 3 stable frames to enter SCROLLING
    allEvents.push(...recognizer.update(peaceNeutral, 0));
    allEvents.push(...recognizer.update(peaceNeutral, 30));
    allEvents.push(...recognizer.update(peaceNeutral, 60));

    expect(recognizer.getCurrentState()).toBe(RecognizerState.SCROLLING);

    // Hand moves UP: palm center Y decreases from 0.50 to 0.38 (diff = -0.12 > dead zone 0.04)
    const peaceHandUp = createPeaceSignHand(0.38);
    for (let t = 90; t <= 180; t += 30) {
      allEvents.push(...recognizer.update(peaceHandUp, t));
    }

    const clicks = allEvents.filter((e) => e.type === 'CLICK');
    const scrolls = allEvents.filter((e) => e.type === 'SCROLL_DELTA');

    expect(clicks.length).toBe(0);
    expect(scrolls.length).toBeGreaterThan(0);

    // Verify scrolling direction is UP (speed < 0 or direction === 'UP')
    const activeScroll = scrolls.find((s) => s.type === 'SCROLL_DELTA' && s.speed !== 0);
    expect(activeScroll).toBeDefined();
    if (activeScroll && activeScroll.type === 'SCROLL_DELTA') {
      expect(activeScroll.direction).toBe('UP');
      expect(activeScroll.speed).toBeLessThan(0);
    }
  });

  it('losing tracking = scroll stops', () => {
    const allEvents: GestureEvent[] = [];

    // Enter SCROLLING state
    const peaceNeutral = createPeaceSignHand(0.50);
    recognizer.update(peaceNeutral, 0);
    recognizer.update(peaceNeutral, 30);
    recognizer.update(peaceNeutral, 60);
    expect(recognizer.getCurrentState()).toBe(RecognizerState.SCROLLING);

    // Frame with lost tracking at t=70: within 150 ms grace period, state stays SCROLLING
    allEvents.push(...recognizer.update(null, 70));
    expect(recognizer.getCurrentState()).toBe(RecognizerState.SCROLLING);

    // Frame with lost tracking at t=230 (> 150 ms after last valid at t=60)
    allEvents.push(...recognizer.update(null, 230));

    expect(recognizer.getCurrentState()).toBe(RecognizerState.IDLE);
    const scrollEnds = allEvents.filter((e) => e.type === 'SCROLL_END');
    expect(scrollEnds.length).toBe(1);
  });

  it('dwell on a button = exactly 1 activation', () => {
    const actionSpy = vi.fn();
    const toolbar = new ToolbarUI({ onAction: actionSpy });

    // Mock button bounds
    const buttons = (toolbar as unknown as { buttonElements: Map<string, HTMLElement> }).buttonElements;
    const refreshBtn = buttons.get('REFRESH');
    expect(refreshBtn).toBeDefined();

    if (refreshBtn) {
      vi.spyOn(refreshBtn, 'getBoundingClientRect').mockReturnValue({
        left: 900,
        right: 980,
        top: 200,
        bottom: 280,
        width: 80,
        height: 80,
        x: 900,
        y: 200,
        toJSON: () => {},
      });
    }

    // Mock container bounds
    const container = (toolbar as unknown as { containerEl: HTMLElement }).containerEl;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 880,
      right: 1000,
      top: 100,
      bottom: 800,
      width: 120,
      height: 700,
      x: 880,
      y: 100,
      toJSON: () => {},
    });

    // Hover inside REFRESH button at (940, 240)
    // Frame at t=0
    let res = toolbar.updateCursor(940, 240, 0);
    expect(res.consumed).toBe(true);
    expect(actionSpy).not.toHaveBeenCalled();

    // Frame at t=500 (halfway through 1000 ms dwell)
    res = toolbar.updateCursor(940, 240, 500);
    expect(res.consumed).toBe(true);
    expect(res.dwellProgress).toBeCloseTo(0.5, 1);
    expect(actionSpy).not.toHaveBeenCalled();

    // Frame at t=1000 (dwell complete)
    res = toolbar.updateCursor(940, 240, 1000);
    expect(res.actionTriggered).toBe('REFRESH');
    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(actionSpy).toHaveBeenCalledWith('REFRESH');

    // Continued hover at t=1200 and t=1500 (within 800 ms cooldown)
    res = toolbar.updateCursor(940, 240, 1200);
    expect(actionSpy).toHaveBeenCalledTimes(1);

    res = toolbar.updateCursor(940, 240, 1500);
    expect(actionSpy).toHaveBeenCalledTimes(1);

    toolbar.destroy();
  });
});
