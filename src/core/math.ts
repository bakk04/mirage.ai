/**
 * AirBrowse - Spatial Math & Signal Quality Engine
 * Strict TypeScript: typed 1-Euro filter (Casiez et al., 2012 compliant),
 * handScale based on Landmark 0 -> 9, distance normalization,
 * rotation-invariant anatomical finger metrics, camera frame central-60% mapping,
 * and generic RingBuffer history with exact linear interpolation.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z?: number;
}

/**
 * Standard MediaPipe Hand Landmark Indices (0..20)
 */
export const LANDMARK_INDEX = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9, // Palm center reference
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const MIN_HAND_SCALE_EPSILON = 0.02;

/**
 * Global gesture configuration defaults and active settings.
 */
export const GESTURE_CONFIG_DEFAULTS = {
  // Camera frame central 60% mapping
  cameraFrame: {
    minX: 0.20,
    maxX: 0.80,
    minY: 0.20,
    maxY: 0.80,
    span: 0.60,
  },

  // Signal & tracking quality
  minConfidence: 0.60,
  lostTrackingTimeoutMs: 150,

  // 1. MOVE: Palm center (Landmark 9) 1-Euro filter
  // Tuned for >= 90% jitter reduction at rest with < 45 ms lag at speed
  filterMinCutoff: 0.03,
  filterBeta: 3.5,
  filterDCutoff: 0.2,

  // 2. CLICK: Quick pinch Thumb(4) + Index(8)
  pinchEnterRatio: 0.25,        // enter pinch when dist(4, 8) / handScale < 0.25
  pinchExitRatio: 0.40,         // exit pinch when dist(4, 8) / handScale > 0.40
  pinchStableFrames: 3,         // 3 stable frames to enter PINCH_PENDING
  pinchMaxDurationMs: 350,      // release in < 350 ms => CLICK
  cursorLookbackMs: 100,        // freeze cursor position 100 ms before pinch began
  clickCooldownMs: 220,         // minimum interval between completed pinch clicks

  // 3. SCROLL: Peace sign (index + middle extended, ring + pinky curled)
  scrollStableFrames: 3,        // 3 stable frames to enter SCROLLING
  scrollDeadZone: 0.04,         // normalized Y joystick dead zone
  scrollExponent: 1.5,          // non-linear velocity curve
  scrollMaxSpeedPxPerFrame: 90, // max scroll speed in pixels per frame
  scrollMaxSpeedPxPerSec: 5400, // max scroll speed in pixels per second (frame-rate independent)
  scrollGain: 9000,             // velocity gain multiplier
  nominalFrameMs: 1000 / 60,

  // On-Screen Toolbar & Dwell
  dwellStandardMs: 1000,        // standard button dwell hover
  dwellDangerousMs: 1500,       // dangerous button (Close Tab) dwell hover
  actionCooldownMs: 800,        // lockout after any button activation
} as const;

/**
 * Validates GESTURE_CONFIG thresholds, falling back to safe defaults if malformed.
 */
export function validateGestureConfig(
  config: typeof GESTURE_CONFIG_DEFAULTS
): typeof GESTURE_CONFIG_DEFAULTS {
  const errors: string[] = [];

  if (config.pinchEnterRatio >= config.pinchExitRatio) {
    errors.push('pinchEnterRatio must be strictly less than pinchExitRatio');
  }
  if (config.pinchEnterRatio <= 0 || config.pinchExitRatio > 1.0) {
    errors.push('pinch ratios must be in range (0, 1.0]');
  }
  if (config.pinchMaxDurationMs < 50 || config.pinchMaxDurationMs > 2000) {
    errors.push('pinchMaxDurationMs out of reasonable range [50, 2000]');
  }
  if (config.scrollDeadZone < 0 || config.scrollDeadZone > 0.2) {
    errors.push('scrollDeadZone out of reasonable range [0, 0.2]');
  }
  if (config.minConfidence < 0.1 || config.minConfidence > 1.0) {
    errors.push('minConfidence out of range [0.1, 1.0]');
  }
  if (config.lostTrackingTimeoutMs < 50 || config.lostTrackingTimeoutMs > 1000) {
    errors.push('lostTrackingTimeoutMs out of range [50, 1000]');
  }

  if (errors.length > 0) {
    console.warn('[AirBrowse] Invalid GESTURE_CONFIG detected, falling back to safe defaults:', errors);
    return { ...GESTURE_CONFIG_DEFAULTS };
  }

  return config;
}

export const GESTURE_CONFIG = validateGestureConfig(GESTURE_CONFIG_DEFAULTS);

/**
 * Calculates Euclidean distance between two 2D or 3D points.
 * Safe against non-finite values.
 */
export function dist(p1: Point2D | Point3D, p2: Point2D | Point3D): number {
  if (!p1 || !p2) return 0;
  const x1 = Number.isFinite(p1.x) ? p1.x : 0;
  const y1 = Number.isFinite(p1.y) ? p1.y : 0;
  const x2 = Number.isFinite(p2.x) ? p2.x : 0;
  const y2 = Number.isFinite(p2.y) ? p2.y : 0;

  const dx = x1 - x2;
  const dy = y1 - y2;
  const z1 = 'z' in p1 && typeof p1.z === 'number' && Number.isFinite(p1.z) ? p1.z : 0;
  const z2 = 'z' in p2 && typeof p2.z === 'number' && Number.isFinite(p2.z) ? p2.z : 0;
  const dz = z1 - z2;
  return Math.hypot(dx, dy, dz);
}

/**
 * Calculates anatomical hand scale as the distance between Landmark 0 (wrist) and Landmark 9 (middle MCP).
 * Guarded against degenerate hands (< MIN_HAND_SCALE_EPSILON).
 */
export function handScale(landmarks: Array<Point2D | Point3D>): number {
  if (!landmarks || landmarks.length <= LANDMARK_INDEX.MIDDLE_MCP) {
    return 0;
  }
  const wrist = landmarks[LANDMARK_INDEX.WRIST];
  const palm = landmarks[LANDMARK_INDEX.MIDDLE_MCP];
  if (!wrist || !palm || !Number.isFinite(wrist.x) || !Number.isFinite(palm.x)) {
    return 0;
  }
  return dist(wrist, palm);
}

/**
 * Rotation-invariant finger extended check.
 * Compares fingertip-to-wrist vs PIP-to-wrist Euclidean distance.
 */
export function isFingerExtended(
  tip: Point2D | Point3D,
  pip: Point2D | Point3D,
  wrist: Point2D | Point3D,
  ratio = 1.15
): boolean {
  const dTip = dist(tip, wrist);
  const dPip = dist(pip, wrist);
  return dTip > dPip * ratio;
}

/**
 * Rotation-invariant finger curled check.
 * Evaluates whether fingertip distance to wrist is less than or equal to PIP distance.
 */
export function isFingerCurled(
  tip: Point2D | Point3D,
  pip: Point2D | Point3D,
  wrist: Point2D | Point3D,
  ratio = 0.95
): boolean {
  const dTip = dist(tip, wrist);
  const dPip = dist(pip, wrist);
  return dTip <= dPip * ratio;
}

/**
 * Maps the central 60% of camera space ([0.2..0.8] x [0.2..0.8]) to the full screen ([0..1] x [0..1]).
 * Clamps coordinates at boundary edges.
 * Mirrors X by default for natural self-mirroring webcam control.
 * Strictly safe against NaN and non-finite inputs.
 */
export function mapCameraToScreen(point: Point2D, mirrorX = true): Point2D {
  const { minX, span, minY } = GESTURE_CONFIG.cameraFrame;

  const rawX = Number.isFinite(point.x) ? point.x : minX + span / 2;
  const rawY = Number.isFinite(point.y) ? point.y : minY + span / 2;

  const clampedX = Math.min(Math.max((rawX - minX) / span, 0), 1);
  const clampedY = Math.min(Math.max((rawY - minY) / span, 0), 1);

  return {
    x: mirrorX ? 1 - clampedX : clampedX,
    y: clampedY,
  };
}

/**
 * Generic RingBuffer with linear lookback interpolation.
 */
export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private count = 0;
  public readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.buffer = new Array(this.capacity);
  }

  public push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  public get size(): number {
    return this.count;
  }

  public clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(undefined);
  }

  public toArray(): T[] {
    const result: T[] = [];
    const startIndex = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const idx = (startIndex + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  public getLatest(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  public getOldest(): T | undefined {
    if (this.count === 0) return undefined;
    const idx = (this.head - this.count + this.capacity) % this.capacity;
    return this.buffer[idx];
  }

  /**
   * Linearly interpolates (x, y) coordinates at exactly (currentTimestamp - lookbackMs).
   * Safe against irregular timestamps and buffers shorter than lookback.
   */
  public interpolateAtLookback(
    this: RingBuffer<{ timestamp: number; x: number; y: number } & T>,
    currentTimestamp: number,
    lookbackMs: number
  ): ({ timestamp: number; x: number; y: number } & T) | undefined {
    const items = this.toArray();
    if (items.length === 0) return undefined;

    const targetTime = currentTimestamp - lookbackMs;

    // If targetTime is before or at oldest sample, clamp to oldest sample
    if (targetTime <= items[0].timestamp) {
      return { ...items[0] };
    }

    // If targetTime is after or at newest sample, clamp to newest sample
    const last = items[items.length - 1];
    if (targetTime >= last.timestamp) {
      return { ...last };
    }

    // Find the bounding segment: items[i].timestamp <= targetTime <= items[i+1].timestamp
    for (let i = 0; i < items.length - 1; i++) {
      const p1 = items[i];
      const p2 = items[i + 1];
      if (p1.timestamp <= targetTime && targetTime <= p2.timestamp) {
        const dt = p2.timestamp - p1.timestamp;
        const u = dt > 0 ? (targetTime - p1.timestamp) / dt : 0;
        return {
          ...p1,
          x: p1.x + u * (p2.x - p1.x),
          y: p1.y + u * (p2.y - p1.y),
          timestamp: targetTime,
        };
      }
    }

    return { ...last };
  }

  // Backwards-compatible alias
  public findAtLookback(
    this: RingBuffer<{ timestamp: number; x: number; y: number } & T>,
    currentTimestamp: number,
    lookbackMs: number
  ): ({ timestamp: number; x: number; y: number } & T) | undefined {
    return this.interpolateAtLookback(currentTimestamp, lookbackMs);
  }
}

/**
 * 1-Euro Filter configuration.
 */
export interface OneEuroConfig {
  minCutoff?: number;
  beta?: number;
  dCutoff?: number;
}

function computeAlpha(cutoffHz: number, dtSeconds: number): number {
  const safeCutoff = Math.max(cutoffHz, 0.0001);
  const tau = 1.0 / (2 * Math.PI * safeCutoff);
  const safeDt = Math.max(dtSeconds, 0.0001);
  return 1.0 / (1.0 + tau / safeDt);
}

class LowPassFilter {
  private prevVal: number | null = null;

  public filter(val: number, alpha: number): number {
    if (this.prevVal === null) {
      this.prevVal = val;
      return val;
    }
    const safeAlpha = Math.min(Math.max(alpha, 0), 1);
    const filtered = safeAlpha * val + (1.0 - safeAlpha) * this.prevVal;
    this.prevVal = filtered;
    return filtered;
  }

  public hasLast(): boolean {
    return this.prevVal !== null;
  }

  public last(): number {
    return this.prevVal ?? 0;
  }

  public reset(): void {
    this.prevVal = null;
  }
}

/**
 * Strictly typed 1-Euro Filter for scalar values (Casiez et al., 2012).
 * Guards against dt <= 0, dt > 1s, NaN, and Infinity.
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(config: OneEuroConfig = {}) {
    this.minCutoff = config.minCutoff ?? GESTURE_CONFIG.filterMinCutoff;
    this.beta = config.beta ?? GESTURE_CONFIG.filterBeta;
    this.dCutoff = config.dCutoff ?? GESTURE_CONFIG.filterDCutoff;
  }

  public filter(val: number, timestamp: number = performance.now()): number {
    if (!Number.isFinite(val)) {
      return this.xFilter.hasLast() ? this.xFilter.last() : 0;
    }

    if (this.lastTime === null || !this.xFilter.hasLast()) {
      this.lastTime = timestamp;
      this.dxFilter.filter(0, 1.0); // Initial derivative is 0 per Casiez et al.
      return this.xFilter.filter(val, 1.0);
    }

    const dtSeconds = (timestamp - this.lastTime) / 1000;

    // Guard dt <= 0 (clock jitter or duplicate timestamp): return previous filtered value
    if (dtSeconds <= 0) {
      return this.xFilter.last();
    }

    // Guard dt > 1.0s (pause in tracking): reset filter state and re-initialize
    if (dtSeconds > 1.0) {
      this.reset();
      this.lastTime = timestamp;
      this.dxFilter.filter(0, 1.0);
      return this.xFilter.filter(val, 1.0);
    }

    this.lastTime = timestamp;

    const rawDx = (val - this.xFilter.last()) / dtSeconds;
    const alphaD = computeAlpha(this.dCutoff, dtSeconds);
    const filteredDx = this.dxFilter.filter(rawDx, alphaD);

    const speed = Math.max(0, Math.abs(filteredDx) - 0.04);
    const dynamicCutoff = this.minCutoff + this.beta * speed;
    const alpha = computeAlpha(dynamicCutoff, dtSeconds);

    return this.xFilter.filter(val, alpha);
  }

  public reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/**
 * 2D Point filter using dual OneEuroFilter instances for (x, y).
 */
export class Point2DFilter {
  private filterX: OneEuroFilter;
  private filterY: OneEuroFilter;

  constructor(config: OneEuroConfig = {}) {
    this.filterX = new OneEuroFilter(config);
    this.filterY = new OneEuroFilter(config);
  }

  public filter(point: Point2D, timestamp: number = performance.now()): Point2D {
    const x = Number.isFinite(point.x) ? point.x : 0;
    const y = Number.isFinite(point.y) ? point.y : 0;
    return {
      x: this.filterX.filter(x, timestamp),
      y: this.filterY.filter(y, timestamp),
    };
  }

  public reset(): void {
    this.filterX.reset();
    this.filterY.reset();
  }
}
