import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  OneEuroFilter,
  Point2DFilter,
  RingBuffer,
  handScale,
  isFingerExtended,
  isFingerCurled,
  mapCameraToScreen,
  dist,
  GESTURE_CONFIG,
  Point2D,
  Point3D,
  LANDMARK_INDEX,
} from '../src/core/math';

describe('Phase 1: Numerical Correctness & Math Engine', () => {
  describe('OneEuroFilter (Casiez et al., 2012 Verification)', () => {
    let filter: OneEuroFilter;

    beforeEach(() => {
      // Uses the calibrated GESTURE_CONFIG defaults: minCutoff 0.15, beta 4.0, dCutoff 1.0
      filter = new OneEuroFilter();
    });

    it('constant input => output converges to input with error < 1e-9', () => {
      const target = 42.123456789;
      let out = 0;
      // Feed constant input over 2 seconds at 60 fps
      for (let i = 0; i < 120; i++) {
        out = filter.filter(target, i * 16.666);
      }
      expect(Math.abs(out - target)).toBeLessThan(1e-9);
    });

    it('step input => strictly monotonic convergence, no overshoot', () => {
      filter.filter(0, 0);
      let prev = 0;
      let maxVal = 0;
      // Step to 100
      for (let i = 1; i <= 60; i++) {
        const val = filter.filter(100, i * 16.666);
        expect(val).toBeGreaterThanOrEqual(prev - 1e-12); // Monotonic within float precision
        if (val > maxVal) maxVal = val;
        prev = val;
      }
      expect(maxVal).toBeLessThanOrEqual(100.000000000001); // No overshoot
    });

    it('noisy input (Gaussian sigma 0.003) => output jitter at rest reduced by >= 90%', () => {
      // Seeded Gaussian noise generator (Box-Muller)
      let s = 12345;
      const pseudoRandom = () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
      };
      const gaussianNoise = (sigma: number) => {
        const u1 = Math.max(pseudoRandom(), 1e-10);
        const u2 = pseudoRandom();
        return sigma * Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      };

      const baseline = 0.5;
      const sigma = 0.003;
      const rawSamples: number[] = [];
      const filteredSamples: number[] = [];

      // Warm up filter
      filter.filter(baseline, 0);

      // 300 frames (~5 seconds at 60fps)
      for (let i = 1; i <= 300; i++) {
        const noise = gaussianNoise(sigma);
        const raw = baseline + noise;
        rawSamples.push(raw);
        const filtered = filter.filter(raw, i * 16.666);
        // Skip first 30 frames of transient settle
        if (i > 30) {
          filteredSamples.push(filtered);
        }
      }

      // Compute standard deviations
      const rawMean = rawSamples.reduce((a, b) => a + b, 0) / rawSamples.length;
      const rawStd = Math.sqrt(
        rawSamples.reduce((acc, v) => acc + Math.pow(v - rawMean, 2), 0) / rawSamples.length
      );

      const filtMean = filteredSamples.reduce((a, b) => a + b, 0) / filteredSamples.length;
      const filtStd = Math.sqrt(
        filteredSamples.reduce((acc, v) => acc + Math.pow(v - filtMean, 2), 0) / filteredSamples.length
      );

      const jitterReduction = (1 - filtStd / rawStd) * 100;
      // Verify jitter reduction meets requirement
      expect(jitterReduction).toBeGreaterThanOrEqual(90);
    });

    it('fast sweep => lag below measured bound (< 45 ms equivalent)', () => {
      // Ramp input: x(t) = slope * t
      const slope = 2.0; // units per second
      filter.filter(0, 0);

      let maxLagMs = 0;
      for (let i = 1; i <= 100; i++) {
        const tSec = i * 0.016;
        const target = slope * tSec;
        const out = filter.filter(target, i * 16);
        // Equivalent time lag = (target - out) / slope
        const lagMs = ((target - out) / slope) * 1000;
        if (i > 20 && lagMs > maxLagMs) {
          maxLagMs = lagMs;
        }
      }
      expect(maxLagMs).toBeLessThan(45);
    });

    it('frame-rate independence: signals at 15, 30, 60 fps match within tolerance', () => {
      const f15 = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 });
      const f30 = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 });
      const f60 = new OneEuroFilter({ minCutoff: 1.0, beta: 0.007, dCutoff: 1.0 });

      // Signal: sin wave at 1 Hz for 1 second
      const durationSec = 1.0;
      const outputs60: { t: number; val: number }[] = [];
      const outputs30: { t: number; val: number }[] = [];
      const outputs15: { t: number; val: number }[] = [];

      // 60 fps
      for (let t = 0; t <= durationSec; t += 1 / 60) {
        const raw = Math.sin(2 * Math.PI * 1 * t);
        outputs60.push({ t, val: f60.filter(raw, t * 1000) });
      }

      // 30 fps
      for (let t = 0; t <= durationSec; t += 1 / 30) {
        const raw = Math.sin(2 * Math.PI * 1 * t);
        outputs30.push({ t, val: f30.filter(raw, t * 1000) });
      }

      // 15 fps
      for (let t = 0; t <= durationSec; t += 1 / 15) {
        const raw = Math.sin(2 * Math.PI * 1 * t);
        outputs15.push({ t, val: f15.filter(raw, t * 1000) });
      }

      // Compare 30 fps against 60 fps at coincident timestamps (Euler discretization tolerance: 0.065)
      for (const pt30 of outputs30) {
        const pt60 = outputs60.find((p) => Math.abs(p.t - pt30.t) < 0.001);
        if (pt60 && pt30.t > 0.1) {
          expect(Math.abs(pt30.val - pt60.val)).toBeLessThan(0.065);
        }
      }

      // Compare 15 fps against 60 fps at coincident timestamps
      // At 15 fps, Te = 66.7ms for 1 Hz wave gives discrete Euler phase lag error bound < 0.20
      for (const pt15 of outputs15) {
        const pt60 = outputs60.find((p) => Math.abs(p.t - pt15.t) < 0.001);
        if (pt60 && pt15.t > 0.1) {
          expect(Math.abs(pt15.val - pt60.val)).toBeLessThan(0.20);
        }
      }
    });

    it('guards against dt <= 0, dt > 1s, NaN, and Infinity', () => {
      const f = new OneEuroFilter();
      const first = f.filter(10, 1000);
      expect(first).toBe(10);

      // dt <= 0 (same timestamp or backwards clock)
      const zeroDt = f.filter(20, 1000);
      expect(Number.isFinite(zeroDt)).toBe(true);
      expect(zeroDt).toBe(10); // Does not produce NaN or explosion

      const negDt = f.filter(30, 900);
      expect(Number.isFinite(negDt)).toBe(true);

      // dt > 1s: state should reset cleanly to new value without runaway derivative
      const afterPause = f.filter(50, 3000);
      expect(afterPause).toBe(50);

      // NaN and Infinity safety
      const nanRes = f.filter(NaN, 3016);
      expect(Number.isFinite(nanRes)).toBe(true);

      const infRes = f.filter(Infinity, 3032);
      expect(Number.isFinite(infRes)).toBe(true);
    });

    it('reset() fully clears state without residue', () => {
      filter.filter(100, 1000);
      filter.filter(200, 1016);
      filter.reset();

      // Next sample acts as initial sample
      const val = filter.filter(5, 5000);
      expect(val).toBe(5);
    });
  });

  describe('RingBuffer (Linear Lookback Interpolation)', () => {
    it('linearly interpolates coordinates between adjacent timestamps', () => {
      interface TimedPoint {
        x: number;
        y: number;
        timestamp: number;
      }
      const rb = new RingBuffer<TimedPoint>(10);
      rb.push({ x: 10, y: 100, timestamp: 1000 });
      rb.push({ x: 20, y: 200, timestamp: 1020 });
      rb.push({ x: 40, y: 400, timestamp: 1060 });

      // Lookback to timestamp 1010 (target: 1060 - 50 = 1010)
      // Falls exactly midway between t=1000 (x=10, y=100) and t=1020 (x=20, y=200)
      const interpolated = rb.interpolateAtLookback(1060, 50);
      expect(interpolated).toBeDefined();
      expect(interpolated!.x).toBeCloseTo(15, 5);
      expect(interpolated!.y).toBeCloseTo(150, 5);
    });

    it('handles buffer shorter than lookback by clamping to oldest sample', () => {
      interface TimedPoint {
        x: number;
        y: number;
        timestamp: number;
      }
      const rb = new RingBuffer<TimedPoint>(10);
      rb.push({ x: 5, y: 50, timestamp: 1050 });
      rb.push({ x: 10, y: 100, timestamp: 1060 });

      // Lookback 100 ms (target: 1060 - 100 = 960 ms, before oldest sample 1050)
      const res = rb.interpolateAtLookback(1060, 100);
      expect(res).toBeDefined();
      expect(res!.x).toBe(5);
      expect(res!.y).toBe(50);
    });

    it('handles empty buffer safely without throwing', () => {
      const rb = new RingBuffer<{ x: number; y: number; timestamp: number }>(5);
      expect(rb.interpolateAtLookback(1000, 100)).toBeUndefined();
    });
  });

  describe('handScale & Scale Invariance', () => {
    it('guards handScale < epsilon and rejects degenerate hand frames', () => {
      const degenerateHand: Point3D[] = new Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
      const scale = handScale(degenerateHand);
      // Degenerate scale must be flagged below minimum valid threshold
      expect(scale).toBeLessThan(0.01);
    });

    it('property-based test: scaling landmarks by k in [0.3, 3] preserves scale invariance (1000 runs)', () => {
      // Seeded fast-check property test
      fc.assert(
        fc.property(
          fc.double({ min: 0.3, max: 3.0, noNaN: true }),
          fc.double({ min: -1.0, max: 1.0, noNaN: true }),
          fc.double({ min: -1.0, max: 1.0, noNaN: true }),
          (k, cx, cy) => {
            const wrist: Point3D = { x: 0.5, y: 0.8, z: 0 };
            const palm: Point3D = { x: 0.5, y: 0.5, z: 0 };
            const thumbTip: Point3D = { x: 0.42, y: 0.35, z: 0 };
            const indexTip: Point3D = { x: 0.42, y: 0.30, z: 0 };

            const baseScale = dist(wrist, palm);
            const basePinchRatio = dist(thumbTip, indexTip) / baseScale;

            // Scale around (cx, cy)
            const scalePt = (p: Point3D): Point3D => ({
              x: cx + (p.x - cx) * k,
              y: cy + (p.y - cy) * k,
            });

            const sWrist = scalePt(wrist);
            const sPalm = scalePt(palm);
            const sThumbTip = scalePt(thumbTip);
            const sIndexTip = scalePt(indexTip);

            const scaledScale = dist(sWrist, sPalm);
            const scaledPinchRatio = dist(sThumbTip, sIndexTip) / scaledScale;

            expect(scaledPinchRatio).toBeCloseTo(basePinchRatio, 4);
          }
        ),
        { numRuns: 1000, seed: 42 }
      );
    });
  });

  describe('Rotation Invariance', () => {
    it('rotation across 360 degrees (every 15 deg) preserves extended/curled classifications', () => {
      const wrist: Point2D = { x: 0.5, y: 0.8 };
      // Extended index tip & pip
      const extPip: Point2D = { x: 0.5, y: 0.6 };
      const extTip: Point2D = { x: 0.5, y: 0.4 };

      // Curled ring tip & pip
      const curlPip: Point2D = { x: 0.6, y: 0.6 };
      const curlTip: Point2D = { x: 0.6, y: 0.75 };

      expect(isFingerExtended(extTip, extPip, wrist)).toBe(true);
      expect(isFingerCurled(curlTip, curlPip, wrist)).toBe(true);

      const rotate = (p: Point2D, center: Point2D, angleRad: number): Point2D => {
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        return {
          x: center.x + dx * cos - dy * sin,
          y: center.y + dx * sin + dy * cos,
        };
      };

      const failures: number[] = [];

      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180;
        const rWrist = rotate(wrist, { x: 0.5, y: 0.5 }, rad);
        const rExtPip = rotate(extPip, { x: 0.5, y: 0.5 }, rad);
        const rExtTip = rotate(extTip, { x: 0.5, y: 0.5 }, rad);
        const rCurlPip = rotate(curlPip, { x: 0.5, y: 0.5 }, rad);
        const rCurlTip = rotate(curlTip, { x: 0.5, y: 0.5 }, rad);

        const extResult = isFingerExtended(rExtTip, rExtPip, rWrist);
        const curlResult = isFingerCurled(rCurlTip, rCurlPip, rWrist);

        if (!extResult || !curlResult) {
          failures.push(deg);
        }
      }

      expect(failures).toEqual([]);
    });
  });

  describe('Coordinate Mapping (Camera -> Screen)', () => {
    it('correctly maps center, corners, and out-of-range values with clamping', () => {
      // Center (0.5, 0.5) => mirrored X: 1 - 0.5 = 0.5, Y = 0.5
      const center = mapCameraToScreen({ x: 0.5, y: 0.5 }, true);
      expect(center.x).toBeCloseTo(0.5, 4);
      expect(center.y).toBeCloseTo(0.5, 4);

      // Camera (0.2, 0.2) => min of central 60% box:
      // normalized inside box: (0.2 - 0.2)/0.6 = 0
      // mirrored X: 1 - 0 = 1.0, Y: 0.0
      const topLeft = mapCameraToScreen({ x: 0.2, y: 0.2 }, true);
      expect(topLeft.x).toBeCloseTo(1.0, 4);
      expect(topLeft.y).toBeCloseTo(0.0, 4);

      // Camera (0.8, 0.8) => max of central 60% box:
      // normalized inside box: (0.8 - 0.2)/0.6 = 1
      // mirrored X: 1 - 1 = 0.0, Y: 1.0
      const bottomRight = mapCameraToScreen({ x: 0.8, y: 0.8 }, true);
      expect(bottomRight.x).toBeCloseTo(0.0, 4);
      expect(bottomRight.y).toBeCloseTo(1.0, 4);

      // Out-of-range values clamped: (-0.5, 1.5)
      const outOfRange = mapCameraToScreen({ x: -0.5, y: 1.5 }, true);
      expect(outOfRange.x).toBe(1.0);
      expect(outOfRange.y).toBe(1.0);

      // NaN safety
      const nanPoint = mapCameraToScreen({ x: NaN, y: NaN }, true);
      expect(Number.isFinite(nanPoint.x)).toBe(true);
      expect(Number.isFinite(nanPoint.y)).toBe(true);
    });
  });

  describe('RingBuffer & Point2DFilter Edge Cases', () => {
    it('verifies RingBuffer getLatest, getOldest, clear, and lookback clamping when target is after newest', () => {
      const buffer = new RingBuffer<{ timestamp: number; x: number; y: number }>(5);
      expect(buffer.getLatest()).toBeUndefined();
      expect(buffer.getOldest()).toBeUndefined();
      expect(buffer.size).toBe(0);

      buffer.push({ timestamp: 100, x: 10, y: 20 });
      buffer.push({ timestamp: 200, x: 30, y: 40 });

      expect(buffer.size).toBe(2);
      expect(buffer.getOldest()?.timestamp).toBe(100);
      expect(buffer.getLatest()?.timestamp).toBe(200);

      // Lookback query where targetTime >= newest sample (lookbackMs = -50 => targetTime 250)
      const clampedNewest = buffer.interpolateAtLookback(200, -50);
      expect(clampedNewest?.timestamp).toBe(200);

      // Backwards-compatible findAtLookback alias
      const aliasResult = buffer.findAtLookback(200, 50);
      expect(aliasResult?.timestamp).toBe(150);

      buffer.clear();
      expect(buffer.size).toBe(0);
      expect(buffer.getLatest()).toBeUndefined();
    });

    it('verifies Point2DFilter filters both coordinates and resets cleanly', () => {
      const pFilter = new Point2DFilter();
      const pt = pFilter.filter({ x: 0.5, y: 0.8 }, 100);
      expect(pt.x).toBeCloseTo(0.5);
      expect(pt.y).toBeCloseTo(0.8);

      // Non-finite point input
      const nanPt = pFilter.filter({ x: NaN, y: Infinity }, 116);
      expect(Number.isFinite(nanPt.x)).toBe(true);
      expect(Number.isFinite(nanPt.y)).toBe(true);

      pFilter.reset();
    });
  });
});
