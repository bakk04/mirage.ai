/**
 * AirBrowse - Finite State Machine Gesture Recognizer
 * Mutually exclusive 3-gesture architecture:
 * 1. MOVE: Palm center (Landmark 9) smoothed with 1-Euro filter, mapped to central 60% of camera frame.
 * 2. CLICK: Quick pinch Thumb(4) + Index(8) with 3-frame entry hysteresis, released in < 350 ms at pre-pinch coordinates (100 ms lookback).
 * 3. SCROLL: Peace sign (index + middle extended, ring + pinky curled) joystick rate control relative to neutral point.
 *
 * Strict TypeScript: NO `any`. Zero legacy gesture logic.
 */

import {
  Point2D,
  Point3D,
  LANDMARK_INDEX,
  GESTURE_CONFIG,
  MIN_HAND_SCALE_EPSILON,
  dist,
  handScale,
  isFingerExtended,
  isFingerCurled,
  mapCameraToScreen,
  Point2DFilter,
  RingBuffer,
} from './math';

export enum RecognizerState {
  IDLE = 'IDLE',
  MOVE = 'MOVE',
  PINCH_PENDING = 'PINCH_PENDING',
  SCROLLING = 'SCROLLING',
}

// Backwards-compatible alias
export const GestureState = RecognizerState;
export type GestureState = RecognizerState;

export type GestureEvent =
  | { type: 'HOVER_MOVE'; x: number; y: number }
  | { type: 'CLICK'; x: number; y: number }
  | { type: 'SCROLL_DELTA'; dy: number; speed: number; direction: 'UP' | 'DOWN' | 'NEUTRAL' }
  | { type: 'SCROLL_END' }
  | { type: 'STATE_CHANGE'; state: RecognizerState };

interface TimestampedCursor {
  x: number;
  y: number;
  timestamp: number;
}

export class GestureRecognizer {
  private state: RecognizerState = RecognizerState.IDLE;

  // Smoothing filter for palm center (Landmark 9)
  private readonly palmFilter = new Point2DFilter({
    minCutoff: GESTURE_CONFIG.filterMinCutoff,
    beta: GESTURE_CONFIG.filterBeta,
    dCutoff: GESTURE_CONFIG.filterDCutoff,
  });

  // Ring buffer of cursor positions (screen normalized 0..1)
  private readonly cursorHistory = new RingBuffer<TimestampedCursor>(60);

  // Current screen cursor coordinates (smoothed Landmark 9 mapped to screen)
  private currentScreenCursor: Point2D = { x: 0.5, y: 0.5 };
  // Smoothed camera-space coordinates of Landmark 9
  private smoothedPalmCamera: Point2D = { x: 0.5, y: 0.5 };
  // Pre-pinch frozen cursor coordinates
  private frozenCursor: Point2D = { x: 0.5, y: 0.5 };

  // Stability counters
  private pinchStableFrames = 0;
  private peaceStableFrames = 0;

  // Pinch timing
  private pinchStartTime = 0;

  // Scroll state
  private neutralY = 0.5;

  // Tracking signal quality
  private lastValidTimestamp = 0;

  public reset(): void {
    this.state = RecognizerState.IDLE;
    this.palmFilter.reset();
    this.cursorHistory.clear();
    this.currentScreenCursor = { x: 0.5, y: 0.5 };
    this.smoothedPalmCamera = { x: 0.5, y: 0.5 };
    this.frozenCursor = { x: 0.5, y: 0.5 };
    this.pinchStableFrames = 0;
    this.peaceStableFrames = 0;
    this.pinchStartTime = 0;
    this.neutralY = 0.5;
    this.lastValidTimestamp = 0;
  }

  private resetTrackingState(): void {
    this.pinchStableFrames = 0;
    this.peaceStableFrames = 0;
    this.pinchStartTime = 0;
  }

  public getCurrentState(): RecognizerState {
    return this.state;
  }

  public getScreenCursor(): Point2D {
    return this.currentScreenCursor;
  }

  public getFrozenCursor(): Point2D {
    return this.frozenCursor;
  }

  // Backwards-compatible alias for existing orchestrator calls
  public getSmoothedIndex(): Point2D {
    return this.currentScreenCursor;
  }

  /**
   * Main evaluation loop.
   * Consumes MediaPipe landmarks, checks confidence, and emits mutually exclusive events.
   */
  public update(
    landmarks: Array<Point2D | Point3D> | null,
    timestamp: number = performance.now(),
    confidence: number = 1.0
  ): GestureEvent[] {
    const events: GestureEvent[] = [];

    // 1. SIGNAL QUALITY & TRACKING LOSS CHECK
    const isFrameValid =
      landmarks !== null &&
      landmarks.length >= 21 &&
      confidence >= GESTURE_CONFIG.minConfidence &&
      landmarks.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) &&
      handScale(landmarks) >= MIN_HAND_SCALE_EPSILON;

    if (!isFrameValid) {
      if (this.lastValidTimestamp === 0) {
        this.state = RecognizerState.IDLE;
        return events;
      }

      const elapsedWithoutTracking = timestamp - this.lastValidTimestamp;
      if (elapsedWithoutTracking <= GESTURE_CONFIG.lostTrackingTimeoutMs) {
        // Keep last state for up to 150 ms of lost tracking
        return events;
      }

      // Tracking lost for > 150 ms: reset to IDLE and stop scrolling
      if (this.state === RecognizerState.SCROLLING) {
        events.push({ type: 'SCROLL_END' });
      }
      this.state = RecognizerState.IDLE;
      this.resetTrackingState();
      events.push({ type: 'STATE_CHANGE', state: RecognizerState.IDLE });
      return events;
    }

    // Hand detected reliably
    this.lastValidTimestamp = timestamp;

    const scale = handScale(landmarks);
    const wrist = landmarks[LANDMARK_INDEX.WRIST];
    const palm = landmarks[LANDMARK_INDEX.MIDDLE_MCP]; // Landmark 9: Palm center
    const thumbTip = landmarks[LANDMARK_INDEX.THUMB_TIP]; // Landmark 4
    const indexTip = landmarks[LANDMARK_INDEX.INDEX_TIP]; // Landmark 8

    // 2. SMOOTH PALM CENTER (LANDMARK 9) - NEVER THE FINGERTIP
    this.smoothedPalmCamera = this.palmFilter.filter({ x: palm.x, y: palm.y }, timestamp);

    // Map central 60% of camera frame to full screen (mirror X)
    this.currentScreenCursor = mapCameraToScreen(this.smoothedPalmCamera, true);

    // Store in history buffer for pre-pinch lookback
    this.cursorHistory.push({
      x: this.currentScreenCursor.x,
      y: this.currentScreenCursor.y,
      timestamp,
    });

    // 3. POSE CLASSIFICATION METRICS
    const distThumbIndex = dist(thumbTip, indexTip);
    const pinchRatio = distThumbIndex / scale;

    const isPeaceSign = this.classifyPeaceSign(landmarks, wrist);

    // =========================================================================
    // STATE MACHINE TRANSITIONS
    // =========================================================================

    // --- CASE A: CURRENTLY SCROLLING ---
    if (this.state === RecognizerState.SCROLLING) {
      if (!isPeaceSign) {
        // Dropping the pose stops scrolling instantly. Scroll never produces a click.
        this.state = RecognizerState.MOVE;
        this.peaceStableFrames = 0;
        events.push({ type: 'SCROLL_END' });
        events.push({ type: 'STATE_CHANGE', state: this.state });
        return events;
      }

      // Scroll speed = joystick: (currentY - neutralY)
      // Hand above neutral (camera Y < neutralY) => page moves up
      // Hand below neutral (camera Y > neutralY) => page moves down
      const diffY = this.smoothedPalmCamera.y - this.neutralY;
      const absDiff = Math.abs(diffY);

      if (absDiff < GESTURE_CONFIG.scrollDeadZone) {
        // Within dead zone: zero speed
        events.push({
          type: 'SCROLL_DELTA',
          dy: diffY,
          speed: 0,
          direction: 'NEUTRAL',
        });
      } else {
        const excess = absDiff - GESTURE_CONFIG.scrollDeadZone;
        const nonLinearSpeed = Math.pow(excess, GESTURE_CONFIG.scrollExponent) * GESTURE_CONFIG.scrollGain;
        const clampedSpeed = Math.min(nonLinearSpeed, GESTURE_CONFIG.scrollMaxSpeedPxPerFrame);

        // In viewport scrolling:
        // Moving page up means scrollBy with negative top (e.g. -speed).
        // Moving page down means scrollBy with positive top (+speed).
        const direction = diffY < 0 ? 'UP' : 'DOWN';
        const speed = diffY < 0 ? -clampedSpeed : clampedSpeed;

        events.push({
          type: 'SCROLL_DELTA',
          dy: diffY,
          speed,
          direction,
        });
      }

      return events;
    }

    // --- CASE B: CURRENTLY IN PINCH_PENDING ---
    if (this.state === RecognizerState.PINCH_PENDING) {
      const isStillPinching = pinchRatio < GESTURE_CONFIG.pinchExitRatio;

      if (isStillPinching) {
        // Still pinching; held longer than 350 ms will simply not produce a click on release
        return events;
      }

      // Pinch released (pinchRatio >= GESTURE_CONFIG.pinchExitRatio)
      const duration = timestamp - this.pinchStartTime;

      if (duration < GESTURE_CONFIG.pinchMaxDurationMs) {
        // Quick pinch release < 350 ms: emit exactly ONE CLICK at pre-pinch coordinates
        events.push({
          type: 'CLICK',
          x: this.frozenCursor.x,
          y: this.frozenCursor.y,
        });
      }
      // If held >= 350 ms: no click emitted

      this.state = RecognizerState.MOVE;
      this.pinchStableFrames = 0;
      events.push({ type: 'STATE_CHANGE', state: this.state });
      return events;
    }

    // --- CASE C: IDLE or MOVE (EVALUATING POSE ENTRY) ---

    // 1. Check SCROLL Entry (Peace sign: 3 stable frames)
    if (isPeaceSign) {
      this.peaceStableFrames++;
      this.pinchStableFrames = 0;

      if (this.peaceStableFrames >= GESTURE_CONFIG.scrollStableFrames) {
        this.state = RecognizerState.SCROLLING;
        // On entry, store the hand's Y as the neutral point
        this.neutralY = this.smoothedPalmCamera.y;
        events.push({ type: 'STATE_CHANGE', state: this.state });
        return events;
      }

      return events;
    } else {
      this.peaceStableFrames = 0;
    }

    // 2. Check PINCH Entry (Quick pinch: 3 stable frames)
    if (pinchRatio < GESTURE_CONFIG.pinchEnterRatio) {
      this.pinchStableFrames++;

      if (this.pinchStableFrames >= GESTURE_CONFIG.pinchStableFrames) {
        this.state = RecognizerState.PINCH_PENDING;
        this.pinchStartTime = timestamp;

        // Freeze cursor position from 100 ms BEFORE the pinch began
        const prePinchSample = this.cursorHistory.interpolateAtLookback(
          timestamp,
          GESTURE_CONFIG.cursorLookbackMs
        );
        this.frozenCursor = prePinchSample
          ? { x: prePinchSample.x, y: prePinchSample.y }
          : { x: this.currentScreenCursor.x, y: this.currentScreenCursor.y };

        events.push({ type: 'STATE_CHANGE', state: this.state });
        return events;
      }

      return events;
    } else {
      this.pinchStableFrames = 0;
    }

    // 3. Relaxed open hand => MOVE
    this.state = RecognizerState.MOVE;
    events.push({
      type: 'HOVER_MOVE',
      x: this.currentScreenCursor.x,
      y: this.currentScreenCursor.y,
    });

    return events;
  }

  /**
   * Anatomical Peace Sign pose classifier:
   * Index + middle extended, ring + pinky curled, thumb ignored.
   */
  private classifyPeaceSign(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    const indexExtended = isFingerExtended(
      landmarks[LANDMARK_INDEX.INDEX_TIP],
      landmarks[LANDMARK_INDEX.INDEX_PIP],
      wrist
    );
    const middleExtended = isFingerExtended(
      landmarks[LANDMARK_INDEX.MIDDLE_TIP],
      landmarks[LANDMARK_INDEX.MIDDLE_PIP],
      wrist
    );
    const ringCurled = isFingerCurled(
      landmarks[LANDMARK_INDEX.RING_TIP],
      landmarks[LANDMARK_INDEX.RING_PIP],
      wrist
    );
    const pinkyCurled = isFingerCurled(
      landmarks[LANDMARK_INDEX.PINKY_TIP],
      landmarks[LANDMARK_INDEX.PINKY_PIP],
      wrist
    );

    return indexExtended && middleExtended && ringCurled && pinkyCurled;
  }
}
