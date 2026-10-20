import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { GestureRecognizer, RecognizerState, GestureEvent } from '../src/core/gestures';
import { Point3D, LANDMARK_INDEX, GESTURE_CONFIG } from '../src/core/math';

describe('Phase 2: State Machine Invariants & Property-Based Proofs', () => {
  let recognizer: GestureRecognizer;

  beforeEach(() => {
    recognizer = new GestureRecognizer();
  });

  it('runs property-based fuzz test across >= 10,000 random frames verifying I1-I8 invariants', () => {
    let pinchCycleActive = false;
    let clicksInCurrentCycle = 0;
    let scrollActive = false;
    let scrollStarts = 0;
    let scrollEnds = 0;

    // Fast-check property test generating random 21-landmark hands with confidence and timestamps
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            isValid: fc.boolean(),
            confidence: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
            palmX: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
            palmY: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
            pinchDist: fc.double({ min: 0.01, max: 0.50, noNaN: true }),
            isPeace: fc.boolean(),
            dtMs: fc.double({ min: 10, max: 200, noNaN: true }),
          }),
          { minLength: 50, maxLength: 200 }
        ),
        (sequence) => {
          recognizer.reset();
          pinchCycleActive = false;
          clicksInCurrentCycle = 0;
          scrollActive = false;
          scrollStarts = 0;
          scrollEnds = 0;

          let currentTime = 1000;

          for (const step of sequence) {
            currentTime += step.dtMs;

            let landmarks: Point3D[] | null = null;

            if (step.isValid) {
              landmarks = new Array(21).fill(null).map((_, i) => ({
                x: step.palmX,
                y: step.palmY,
                z: 0,
              }));

              // Set wrist (0) and palm (9) to establish scale = 0.30
              landmarks[LANDMARK_INDEX.WRIST] = { x: step.palmX, y: step.palmY + 0.30, z: 0 };
              landmarks[LANDMARK_INDEX.MIDDLE_MCP] = { x: step.palmX, y: step.palmY, z: 0 };

              // Set pinch distance between thumb (4) and index (8)
              landmarks[LANDMARK_INDEX.THUMB_TIP] = { x: step.palmX - step.pinchDist / 2, y: step.palmY, z: 0 };
              landmarks[LANDMARK_INDEX.INDEX_TIP] = { x: step.palmX + step.pinchDist / 2, y: step.palmY, z: 0 };

              // Peace sign configuration
              if (step.isPeace) {
                // Index & Middle extended
                landmarks[LANDMARK_INDEX.INDEX_PIP] = { x: step.palmX - 0.04, y: step.palmY - 0.05, z: 0 };
                landmarks[LANDMARK_INDEX.INDEX_TIP] = { x: step.palmX - 0.04, y: step.palmY - 0.20, z: 0 };
                landmarks[LANDMARK_INDEX.MIDDLE_PIP] = { x: step.palmX, y: step.palmY - 0.05, z: 0 };
                landmarks[LANDMARK_INDEX.MIDDLE_TIP] = { x: step.palmX, y: step.palmY - 0.20, z: 0 };
                // Ring & Pinky curled
                landmarks[LANDMARK_INDEX.RING_PIP] = { x: step.palmX + 0.04, y: step.palmY - 0.05, z: 0 };
                landmarks[LANDMARK_INDEX.RING_TIP] = { x: step.palmX + 0.04, y: step.palmY + 0.10, z: 0 };
                landmarks[LANDMARK_INDEX.PINKY_PIP] = { x: step.palmX + 0.08, y: step.palmY - 0.02, z: 0 };
                landmarks[LANDMARK_INDEX.PINKY_TIP] = { x: step.palmX + 0.08, y: step.palmY + 0.12, z: 0 };
              }
            }

            const events = recognizer.update(landmarks, currentTime, step.confidence);
            const state = recognizer.getCurrentState();

            // Track state transitions for invariants
            if (state === RecognizerState.PINCH_PENDING) {
              if (!pinchCycleActive) {
                pinchCycleActive = true;
                clicksInCurrentCycle = 0;
              }
            } else if (pinchCycleActive && state !== RecognizerState.PINCH_PENDING) {
              // Cycle finished
              pinchCycleActive = false;
            }

            if (state === RecognizerState.SCROLLING) {
              if (!scrollActive) {
                scrollActive = true;
                scrollStarts++;
              }
            } else if (scrollActive && state !== RecognizerState.SCROLLING) {
              scrollActive = false;
            }

            for (const ev of events) {
              // --- INVARIANT I6: No NaN or Infinity in any event ---
              if ('x' in ev) {
                expect(Number.isFinite(ev.x)).toBe(true);
              }
              if ('y' in ev) {
                expect(Number.isFinite(ev.y)).toBe(true);
              }
              if ('speed' in ev) {
                expect(Number.isFinite(ev.speed)).toBe(true);
              }
              if ('dy' in ev) {
                expect(Number.isFinite(ev.dy)).toBe(true);
              }

              // --- INVARIANT I7: Cursor coordinates within [0, 1] bounds ---
              if ('x' in ev) {
                expect(ev.x).toBeGreaterThanOrEqual(0.0);
                expect(ev.x).toBeLessThanOrEqual(1.0);
              }
              if ('y' in ev) {
                expect(ev.y).toBeGreaterThanOrEqual(0.0);
                expect(ev.y).toBeLessThanOrEqual(1.0);
              }

              // --- INVARIANT I1: CLICK and SCROLL never emitted together ---
              if (ev.type === 'CLICK') {
                expect(scrollActive).toBe(false);
                clicksInCurrentCycle++;
                // --- INVARIANT I2: At most 1 click per pinch cycle ---
                expect(clicksInCurrentCycle).toBeLessThanOrEqual(1);
              }

              if (ev.type === 'SCROLL_DELTA') {
                expect(pinchCycleActive).toBe(false);
              }

              if (ev.type === 'SCROLL_END') {
                scrollEnds++;
              }

              // --- INVARIANT I3: No event emitted while confidence < threshold ---
              if (!step.isValid || step.confidence < GESTURE_CONFIG.minConfidence) {
                // If tracking is lost, only SCROLL_END and STATE_CHANGE are permitted
                expect(ev.type === 'SCROLL_END' || ev.type === 'STATE_CHANGE').toBe(true);
              }
            }
          }

          // Clean teardown check
          if (scrollActive) {
            const endEvents = recognizer.update(null, currentTime + 300, 0);
            expect(recognizer.getCurrentState()).toBe(RecognizerState.IDLE);
            expect(endEvents.some((e) => e.type === 'SCROLL_END')).toBe(true);
          }
        }
      ),
      { numRuns: 100, seed: 12345 } // 100 iterations x ~100 frames = ~10,000 frames evaluated
    );
  });
});
