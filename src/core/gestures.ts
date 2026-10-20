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

const ZOOM_MOTION_THRESHOLD = 0.035;

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
  | { type: 'SCROLL_DELTA'; dy: number; speed: number; direction: 'UP' | 'DOWN' | 'NEUTRAL'; frameScale: number }
  | { type: 'SCROLL_END' }
  | { type: 'COMMAND'; command: 'REFRESH' | 'CLOSE_WINDOW' | 'TOGGLE_KEYBOARD' | 'ZOOM_IN' | 'ZOOM_OUT' }
  | { type: 'STATE_CHANGE'; state: RecognizerState };

interface TimestampedCursor {
  x: number;
  y: number;
  timestamp: number;
}

interface TimestampedPalm {
  x: number;
  y: number;
  timestamp: number;
}

export class GestureRecognizer {
  private state: RecognizerState = RecognizerState.IDLE;
  private lastConfidence = 0;
  private lastDecisionReason = 'Waiting for a valid hand';

  // Smoothing filter for palm center (Landmark 9)
  private palmFilter = new Point2DFilter({
    minCutoff: GESTURE_CONFIG.filterMinCutoff,
    beta: GESTURE_CONFIG.filterBeta,
    dCutoff: GESTURE_CONFIG.filterDCutoff,
  });
  private indexFilter = new Point2DFilter({
    minCutoff: GESTURE_CONFIG.filterMinCutoff,
    beta: GESTURE_CONFIG.filterBeta,
    dCutoff: GESTURE_CONFIG.filterDCutoff,
  });

  // Ring buffer of cursor positions (screen normalized 0..1)
  private readonly cursorHistory = new RingBuffer<TimestampedCursor>(60);
  private readonly palmHistory = new RingBuffer<TimestampedPalm>(12);

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
  private lastClickTimestamp = -Infinity;
  private lastScrollTimestamp = 0;
  private lastCommandMotion = 0;

  // Scroll state
  private neutralY = 0.5;

  // Tracking signal quality
  private lastValidTimestamp = 0;
  private mirrorX = true;
  private enableRefreshGesture = true;
  private enableDangerousGestures = false;
  private lastCommandTimestamp = -Infinity;
  private commandPose: 'OPEN' | 'THREE' | null = null;
  private commandStableFrames = 0;
  private commandTriggeredPose: 'OPEN' | 'THREE' | null = null;
  private zoomTriggered = false;

  public setInteractionSettings(
    smoothing: 'low' | 'med' | 'high',
    leftHandedMode: boolean,
    enableRefreshGesture = true,
    enableDangerousGestures = false
  ): void {
    const presets = {
      low: { minCutoff: 0.08, beta: 5.5, dCutoff: 0.3 },
      med: { minCutoff: 0.03, beta: 3.5, dCutoff: 0.2 },
      high: { minCutoff: 0.015, beta: 2.2, dCutoff: 0.12 },
    } as const;
    this.palmFilter = new Point2DFilter(presets[smoothing]);
    this.mirrorX = !leftHandedMode;
    this.enableRefreshGesture = enableRefreshGesture;
    this.enableDangerousGestures = enableDangerousGestures;
    this.reset();
  }

  public reset(): void {
    this.state = RecognizerState.IDLE;
    this.palmFilter.reset();
    this.indexFilter.reset();
    this.cursorHistory.clear();
    this.palmHistory.clear();
    this.currentScreenCursor = { x: 0.5, y: 0.5 };
    this.smoothedPalmCamera = { x: 0.5, y: 0.5 };
    this.frozenCursor = { x: 0.5, y: 0.5 };
    this.pinchStableFrames = 0;
    this.peaceStableFrames = 0;
    this.pinchStartTime = 0;
    this.lastClickTimestamp = -Infinity;
    this.lastScrollTimestamp = 0;
    this.lastCommandMotion = 0;
    this.neutralY = 0.5;
    this.lastValidTimestamp = 0;
    this.commandPose = null;
    this.commandStableFrames = 0;
    this.commandTriggeredPose = null;
    this.zoomTriggered = false;
    this.lastConfidence = 0;
    this.lastDecisionReason = 'Waiting for a valid hand';
  }

  private resetTrackingState(): void {
    this.pinchStableFrames = 0;
    this.peaceStableFrames = 0;
    this.pinchStartTime = 0;
    this.palmHistory.clear();
    this.lastScrollTimestamp = 0;
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

  public getDiagnostics(): {
    confidence: number;
    stabilityFrames: number;
    reason: string;
  } {
    return {
      confidence: this.lastConfidence,
      stabilityFrames: Math.max(
        this.pinchStableFrames,
        this.peaceStableFrames,
        this.commandStableFrames
      ),
      reason: this.lastDecisionReason,
    };
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
    this.lastConfidence = confidence;

    // 1. SIGNAL QUALITY & TRACKING LOSS CHECK
    const isFrameValid =
      landmarks !== null &&
      landmarks.length >= 21 &&
      confidence >= GESTURE_CONFIG.minConfidence &&
      landmarks.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) &&
      handScale(landmarks) >= MIN_HAND_SCALE_EPSILON;

    if (!isFrameValid) {
      this.lastDecisionReason =
        landmarks === null
          ? 'Ignored: no hand landmarks'
          : confidence < GESTURE_CONFIG.minConfidence
            ? `Ignored: confidence ${confidence.toFixed(2)} below ${GESTURE_CONFIG.minConfidence.toFixed(2)}`
            : 'Ignored: invalid or degenerate landmarks';
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
    const smoothedIndexCamera = this.indexFilter.filter(
      { x: indexTip.x, y: indexTip.y },
      timestamp
    );

    // Use the index fingertip for precise pointing; palm remains the scroll anchor.
    this.currentScreenCursor = mapCameraToScreen(smoothedIndexCamera, this.mirrorX);

    // Store in history buffer for pre-pinch lookback
    this.cursorHistory.push({
      x: this.currentScreenCursor.x,
      y: this.currentScreenCursor.y,
      timestamp,
    });
    // Keep command-motion measurements close to the observed landmarks. The
    // filtered palm is intentionally used for scroll output, but using it for
    // command displacement would delay short zoom/keyboard movements.
    this.palmHistory.push({ x: palm.x, y: palm.y, timestamp });

    // 3. POSE CLASSIFICATION METRICS
    const distThumbIndex = dist(thumbTip, indexTip);
    const pinchRatio = distThumbIndex / scale;

    const isPeaceSign = this.classifyPeaceSign(landmarks, wrist);
    const isThreeFinger = this.classifyThreeFinger(landmarks, wrist);
    const isPinching = pinchRatio < GESTURE_CONFIG.pinchExitRatio;
    const isFourFinger = !isPinching && this.classifyFourFinger(landmarks, wrist);
    const isFiveFinger = !isPinching && this.classifyFiveFinger(landmarks, wrist);
    const commandPose = isFiveFinger ? 'OPEN' : isThreeFinger ? 'THREE' : null;
    const motion = this.getPalmMotion();
    if (commandPose === null) {
      this.commandPose = null;
      this.commandStableFrames = 0;
      this.commandTriggeredPose = null;
    } else if (commandPose === this.commandPose) {
      this.commandStableFrames++;
    } else {
      this.commandPose = commandPose;
      this.commandStableFrames = 1;
    }

    // =========================================================================
    // STATE MACHINE TRANSITIONS
    // =========================================================================

    // Command poses are checked before the scroll branch. The previous
    // implementation only checked them while scrolling and required the hand
    // to remain a peace sign, making three-finger refresh unreachable.
    if (
      this.state !== RecognizerState.PINCH_PENDING &&
      commandPose !== null &&
      commandPose === this.commandPose &&
      this.commandStableFrames >= GESTURE_CONFIG.scrollStableFrames &&
      this.commandTriggeredPose !== commandPose &&
      timestamp - this.lastCommandTimestamp >= GESTURE_CONFIG.actionCooldownMs
    ) {
      // A deliberate horizontal movement turns an open hand into the keyboard
      // compound gesture instead of allowing the dangerous close action.
      if (commandPose === 'OPEN' && Math.abs(motion.dx) >= 0.12) {
        this.lastCommandTimestamp = timestamp;
        this.commandTriggeredPose = commandPose;
        events.push({ type: 'COMMAND', command: 'TOGGLE_KEYBOARD' });
        this.lastDecisionReason = 'Keyboard toggle: stable open hand with horizontal motion';
        return events;
      }
      if (
        (commandPose === 'THREE' && this.enableRefreshGesture) ||
        (commandPose === 'OPEN' &&
          this.enableDangerousGestures &&
          Math.abs(motion.dx) < 0.12)
      ) {
        this.lastCommandTimestamp = timestamp;
        this.commandTriggeredPose = commandPose;
        events.push({
          type: 'COMMAND',
          command: commandPose === 'THREE' ? 'REFRESH' : 'CLOSE_WINDOW',
        });
        this.lastDecisionReason = commandPose === 'THREE'
          ? 'Refresh: stable three-finger pose'
          : 'Window close: explicit dangerous gesture enabled';
        return events;
      }
    }

    if (!isFourFinger) {
      this.zoomTriggered = false;
    }
    if (
      isFourFinger &&
      Math.abs(motion.dy) >= ZOOM_MOTION_THRESHOLD &&
      !this.zoomTriggered &&
      timestamp - this.lastCommandTimestamp >= GESTURE_CONFIG.actionCooldownMs
    ) {
      this.lastCommandTimestamp = timestamp;
      this.zoomTriggered = true;
      events.push({ type: 'COMMAND', command: motion.dy < 0 ? 'ZOOM_IN' : 'ZOOM_OUT' });
      this.lastDecisionReason = motion.dy < 0
        ? 'Zoom in: four-finger pose moved upward'
        : 'Zoom out: four-finger pose moved downward';
      return events;
    }

    // Command poses are exclusive. Even when a command is disabled, cooling
    // down, or waiting for enough movement, do not let the same landmarks
    // fall through to pinch, pointer, or scroll recognition.
    if (
      this.state !== RecognizerState.PINCH_PENDING &&
      (isFiveFinger || isFourFinger || isThreeFinger)
    ) {
      if (this.state === RecognizerState.SCROLLING) {
        this.state = RecognizerState.MOVE;
        this.peaceStableFrames = 0;
        events.push({ type: 'SCROLL_END' });
      }
      this.state = RecognizerState.MOVE;
      this.pinchStableFrames = 0;
      this.peaceStableFrames = 0;
      this.lastDecisionReason = isFiveFinger
        ? this.enableDangerousGestures
          ? 'Five-finger close pose reserved until stable'
          : 'Five-finger close ignored: enable it in Settings'
        : isFourFinger
          ? 'Four-finger zoom pose reserved'
          : 'Three-finger refresh pose reserved';
      return events;
    }

    // --- CASE A: CURRENTLY SCROLLING ---
    if (this.state === RecognizerState.SCROLLING) {
      if (!isPeaceSign) {
        // Dropping the pose stops scrolling instantly. Scroll never produces a click.
        this.state = RecognizerState.MOVE;
        this.peaceStableFrames = 0;
        events.push({ type: 'SCROLL_END' });
        events.push({ type: 'STATE_CHANGE', state: this.state });
        this.lastDecisionReason = 'Scroll ended: peace-sign pose released';
        return events;
      }

      // Scroll speed = joystick: (currentY - neutralY)
      // Hand above neutral (camera Y < neutralY) => page moves up
      // Hand below neutral (camera Y > neutralY) => page moves down
      // Use the current decoded landmark for the joystick displacement. The
      // cursor remains filtered, but using the heavily filtered palm here can
      // keep short downward movements inside the dead zone and make scrolling
      // appear one-directional.
      const diffY = palm.y - this.neutralY;
      const absDiff = Math.abs(diffY);

      if (absDiff < GESTURE_CONFIG.scrollDeadZone) {
        // Within dead zone: zero speed
        events.push({
          type: 'SCROLL_DELTA',
          dy: diffY,
          speed: 0,
          direction: 'NEUTRAL',
          frameScale: 0,
        });
        this.lastDecisionReason = 'Scroll held in dead zone';
      } else {
        const excess = absDiff - GESTURE_CONFIG.scrollDeadZone;
        const displacementSpeed = Math.pow(excess, GESTURE_CONFIG.scrollExponent) * GESTURE_CONFIG.scrollGain;
        const velocitySpeed = Math.min(
          Math.abs(motion.vy) * 1100,
          GESTURE_CONFIG.scrollMaxSpeedPxPerFrame * 1.5
        );
        const nonLinearSpeed = displacementSpeed + velocitySpeed;
        const clampedSpeed = Math.min(nonLinearSpeed, GESTURE_CONFIG.scrollMaxSpeedPxPerFrame);
        const elapsedMs = this.lastScrollTimestamp > 0
          ? Math.max(1, timestamp - this.lastScrollTimestamp)
          : GESTURE_CONFIG.nominalFrameMs;
        const frameScale = Math.min(elapsedMs, 100) / GESTURE_CONFIG.nominalFrameMs;

        // In viewport scrolling:
        // Moving page up means scrollBy with negative top (e.g. -speed).
        // Moving page down means scrollBy with positive top (+speed).
        const direction = diffY < 0 ? 'UP' : 'DOWN';
        const frameSpeed = Math.min(
          clampedSpeed * frameScale,
          GESTURE_CONFIG.scrollMaxSpeedPxPerFrame
        );
        const speed = diffY < 0 ? -frameSpeed : frameSpeed;

        events.push({
          type: 'SCROLL_DELTA',
          dy: diffY,
          speed,
          direction,
          frameScale,
        });
        this.lastDecisionReason = `Scrolling ${direction.toLowerCase()}`;
      }

      this.lastScrollTimestamp = timestamp;
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

      if (
        duration < GESTURE_CONFIG.pinchMaxDurationMs &&
        timestamp - this.lastClickTimestamp >= GESTURE_CONFIG.clickCooldownMs
      ) {
        // Quick pinch release < 350 ms: emit exactly ONE CLICK at pre-pinch coordinates
        events.push({
          type: 'CLICK',
          x: this.frozenCursor.x,
          y: this.frozenCursor.y,
        });
        this.lastDecisionReason = 'Click: quick pinch released';
        this.lastClickTimestamp = timestamp;
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
        this.neutralY = palm.y;
        this.lastScrollTimestamp = timestamp;
        events.push({ type: 'STATE_CHANGE', state: this.state });
        this.lastDecisionReason = 'Scroll armed: stable peace-sign pose';
        return events;
      }

      this.lastDecisionReason = `Scroll pending: ${this.peaceStableFrames}/${GESTURE_CONFIG.scrollStableFrames} stable frames`;

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
        this.lastDecisionReason = 'Pinch armed: waiting for release';
        return events;
      }

      this.lastDecisionReason = `Pinch pending: ${this.pinchStableFrames}/${GESTURE_CONFIG.pinchStableFrames} stable frames`;
      return events;
    } else {
      this.pinchStableFrames = 0;
    }

    // 3. Relaxed open hand => MOVE
    this.state = RecognizerState.MOVE;
    this.lastDecisionReason = 'Pointer tracking active; no command pose';
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
    const indexExtended = this.isExtended(
      landmarks[LANDMARK_INDEX.INDEX_TIP],
      landmarks[LANDMARK_INDEX.INDEX_PIP],
      wrist,
      1.12
    );
    const middleExtended = this.isExtended(
      landmarks[LANDMARK_INDEX.MIDDLE_TIP],
      landmarks[LANDMARK_INDEX.MIDDLE_PIP],
      wrist,
      1.12
    );
    const ringCurled = this.isCurled(
      landmarks[LANDMARK_INDEX.RING_TIP],
      landmarks[LANDMARK_INDEX.RING_PIP],
      wrist,
      0.98
    );
    const pinkyCurled = this.isCurled(
      landmarks[LANDMARK_INDEX.PINKY_TIP],
      landmarks[LANDMARK_INDEX.PINKY_PIP],
      wrist,
      0.98
    );

    return indexExtended && middleExtended && ringCurled && pinkyCurled;
  }

  private classifyThreeFinger(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    return (
      this.isExtended(landmarks[LANDMARK_INDEX.INDEX_TIP], landmarks[LANDMARK_INDEX.INDEX_PIP], wrist, 1.12) &&
      this.isExtended(landmarks[LANDMARK_INDEX.MIDDLE_TIP], landmarks[LANDMARK_INDEX.MIDDLE_PIP], wrist, 1.12) &&
      this.isExtended(landmarks[LANDMARK_INDEX.RING_TIP], landmarks[LANDMARK_INDEX.RING_PIP], wrist, 1.12) &&
      this.isCurled(landmarks[LANDMARK_INDEX.PINKY_TIP], landmarks[LANDMARK_INDEX.PINKY_PIP], wrist, 0.98)
    );
  }

  private classifyOpenHand(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    return (
      isFingerExtended(landmarks[LANDMARK_INDEX.INDEX_TIP], landmarks[LANDMARK_INDEX.INDEX_PIP], wrist) &&
      isFingerExtended(landmarks[LANDMARK_INDEX.MIDDLE_TIP], landmarks[LANDMARK_INDEX.MIDDLE_PIP], wrist) &&
      isFingerExtended(landmarks[LANDMARK_INDEX.RING_TIP], landmarks[LANDMARK_INDEX.RING_PIP], wrist) &&
      isFingerExtended(landmarks[LANDMARK_INDEX.PINKY_TIP], landmarks[LANDMARK_INDEX.PINKY_PIP], wrist)
    );
  }

  private classifyFourFinger(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    return (
      this.isExtended(landmarks[LANDMARK_INDEX.INDEX_TIP], landmarks[LANDMARK_INDEX.INDEX_PIP], wrist, 1.12) &&
      this.isExtended(landmarks[LANDMARK_INDEX.MIDDLE_TIP], landmarks[LANDMARK_INDEX.MIDDLE_PIP], wrist, 1.12) &&
      this.isExtended(landmarks[LANDMARK_INDEX.RING_TIP], landmarks[LANDMARK_INDEX.RING_PIP], wrist, 1.12) &&
      this.isExtended(landmarks[LANDMARK_INDEX.PINKY_TIP], landmarks[LANDMARK_INDEX.PINKY_PIP], wrist, 1.12) &&
      !this.isThumbExtended(landmarks, wrist)
    );
  }

  private classifyFiveFinger(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    return this.classifyOpenHand(landmarks, wrist) && this.isThumbExtended(landmarks, wrist);
  }

  private isThumbExtended(
    landmarks: Array<Point2D | Point3D>,
    wrist: Point2D | Point3D
  ): boolean {
    return (
      dist(landmarks[LANDMARK_INDEX.THUMB_TIP], wrist) >
      dist(landmarks[LANDMARK_INDEX.THUMB_IP], wrist) * 1.1
    );
  }

  private isExtended(
    tip: Point2D | Point3D,
    pip: Point2D | Point3D,
    wrist: Point2D | Point3D,
    ratio = 1.03
  ): boolean {
    return isFingerExtended(tip, pip, wrist, ratio);
  }

  private isCurled(
    tip: Point2D | Point3D,
    pip: Point2D | Point3D,
    wrist: Point2D | Point3D,
    ratio = 1.12
  ): boolean {
    return isFingerCurled(tip, pip, wrist, ratio);
  }

  private getPalmMotion(): { dx: number; dy: number; vx: number; vy: number } {
    const samples = this.palmHistory.toArray();
    if (samples.length < 2) return { dx: 0, dy: 0, vx: 0, vy: 0 };
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = Math.max(1, last.timestamp - first.timestamp);
    return {
      dx: last.x - first.x,
      dy: last.y - first.y,
      vx: (last.x - first.x) / dt * 1000,
      vy: (last.y - first.y) / dt * 1000,
    };
  }
}
