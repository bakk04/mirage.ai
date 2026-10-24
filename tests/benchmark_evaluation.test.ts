import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { GestureRecognizer, RecognizerState, GestureEvent } from '../src/core/gestures';
import { LANDMARK_INDEX, Point3D } from '../src/core/math';

/**
 * AirBrowse Scientific Benchmark Suite
 * Generates reproducible evaluation dataset across all supported gesture classes
 * and negative/edge cases, directly invoking Mirage's GestureRecognizer engine.
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
    { x: 0.50, y: 0.50, z: 0 }, // 9: MIDDLE_MCP (palm center)
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

function perturbHand(
  hand: Point3D[],
  options: {
    noise?: number;
    scale?: number;
    shiftX?: number;
    shiftY?: number;
    rotateDeg?: number;
  } = {}
): Point3D[] {
  const { noise = 0.003, scale = 1.0, shiftX = 0, shiftY = 0, rotateDeg = 0 } = options;
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const wrist = hand[0];
  return hand.map((pt) => {
    const dx = (pt.x - wrist.x) * scale;
    const dy = (pt.y - wrist.y) * scale;

    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;

    const nX = (Math.random() - 0.5) * 2 * noise;
    const nY = (Math.random() - 0.5) * 2 * noise;

    return {
      x: wrist.x + rx + shiftX + nX,
      y: wrist.y + ry + shiftY + nY,
      z: pt.z !== undefined ? pt.z * scale : 0,
    };
  });
}

/**
 * 1. Natural Pointing Hand (Index extended, others curled/relaxed) -> MOVE
 */
function createPointingHand(palmY = 0.50): Point3D[] {
  const wristY = palmY + 0.30;
  return createSyntheticHand({
    [LANDMARK_INDEX.WRIST]: { x: 0.50, y: wristY },
    [LANDMARK_INDEX.MIDDLE_MCP]: { x: 0.50, y: palmY },
    // Index extended
    [LANDMARK_INDEX.INDEX_MCP]: { x: 0.44, y: palmY + 0.05 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.44, y: palmY - 0.05 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.44, y: palmY - 0.20 },
    // Middle curled
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: palmY - 0.05 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: palmY + 0.10 },
    // Ring curled
    [LANDMARK_INDEX.RING_PIP]: { x: 0.56, y: palmY - 0.05 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.56, y: palmY + 0.10 },
    // Pinky curled
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.62, y: palmY - 0.02 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.62, y: palmY + 0.12 },
  });
}

/**
 * 2. Peace Sign Hand (Index + Middle extended, Ring + Pinky curled) -> SCROLL
 */
function createPeaceSignHand(palmY = 0.50): Point3D[] {
  const wristY = palmY + 0.30;
  return createSyntheticHand({
    [LANDMARK_INDEX.WRIST]: { x: 0.50, y: wristY },
    [LANDMARK_INDEX.MIDDLE_MCP]: { x: 0.50, y: palmY },
    [LANDMARK_INDEX.INDEX_MCP]: { x: 0.44, y: palmY + 0.05 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.44, y: palmY - 0.05 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.44, y: palmY - 0.20 },
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: palmY - 0.05 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: palmY - 0.22 },
    [LANDMARK_INDEX.RING_MCP]: { x: 0.56, y: palmY + 0.05 },
    [LANDMARK_INDEX.RING_PIP]: { x: 0.56, y: palmY - 0.05 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.56, y: palmY + 0.10 },
    [LANDMARK_INDEX.PINKY_MCP]: { x: 0.62, y: palmY + 0.08 },
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.62, y: palmY - 0.02 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.62, y: palmY + 0.12 },
  });
}

/**
 * 3. Three-Finger Hand (Index, Middle, Ring extended, Pinky curled) -> REFRESH
 */
function createThreeFingerHand(): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.20 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.43, y: 0.45 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: 0.18 },
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: 0.40 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.58, y: 0.20 },
    [LANDMARK_INDEX.RING_PIP]: { x: 0.57, y: 0.45 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.62, y: 0.68 },
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.64, y: 0.52 },
  });
}

/**
 * 4. Four-Finger Hand with consistent relative joints -> ZOOM
 */
function createFourFingerHand(palmY = 0.50): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.MIDDLE_MCP]: { x: 0.50, y: palmY },
    [LANDMARK_INDEX.WRIST]: { x: 0.50, y: palmY + 0.30 },
    [LANDMARK_INDEX.THUMB_TIP]: { x: 0.50, y: palmY + 0.18 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: palmY - 0.20 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.42, y: palmY - 0.05 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: palmY - 0.22 },
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: palmY - 0.05 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.58, y: palmY - 0.20 },
    [LANDMARK_INDEX.RING_PIP]: { x: 0.58, y: palmY - 0.05 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.66, y: palmY - 0.16 },
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.66, y: palmY - 0.02 },
  });
}

/**
 * 5. Open Five-Finger Hand with horizontal displacement -> TOGGLE_KEYBOARD
 */
function createOpenHand(palmX = 0.50): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.MIDDLE_MCP]: { x: palmX, y: 0.50 },
    [LANDMARK_INDEX.WRIST]: { x: palmX, y: 0.80 },
    [LANDMARK_INDEX.THUMB_TIP]: { x: palmX - 0.22, y: 0.55 },
    [LANDMARK_INDEX.THUMB_IP]: { x: palmX - 0.18, y: 0.60 },
  });
}

function createFistHand(): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.THUMB_TIP]: { x: 0.45, y: 0.60 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.45, y: 0.62 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: 0.63 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.55, y: 0.62 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.60, y: 0.65 },
  });
}

function createRockSignHand(): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.20 },
    [LANDMARK_INDEX.INDEX_PIP]: { x: 0.43, y: 0.45 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: 0.62 },
    [LANDMARK_INDEX.MIDDLE_PIP]: { x: 0.50, y: 0.45 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.56, y: 0.62 },
    [LANDMARK_INDEX.RING_PIP]: { x: 0.56, y: 0.45 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.65, y: 0.22 },
    [LANDMARK_INDEX.PINKY_PIP]: { x: 0.64, y: 0.45 },
  });
}

function createThumbsUpHand(): Point3D[] {
  return createSyntheticHand({
    [LANDMARK_INDEX.THUMB_TIP]: { x: 0.25, y: 0.20 },
    [LANDMARK_INDEX.INDEX_TIP]: { x: 0.45, y: 0.62 },
    [LANDMARK_INDEX.MIDDLE_TIP]: { x: 0.50, y: 0.63 },
    [LANDMARK_INDEX.RING_TIP]: { x: 0.55, y: 0.62 },
    [LANDMARK_INDEX.PINKY_TIP]: { x: 0.60, y: 0.65 },
  });
}

interface BenchmarkSampleResult {
  sample_id: string;
  ground_truth: string;
  predicted_label: string;
  is_correct: number;
  confidence: number;
  inference_time_ms: number;
  reason: string;
}

describe('Mirage Scientific Gesture Benchmark Suite', () => {
  it('generates real model predictions across all supported classes and edge cases', () => {
    const results: BenchmarkSampleResult[] = [];
    const SAMPLES_PER_CLASS = 60;
    let sampleCounter = 0;

    const executeTrial = (
      groundTruth: string,
      sequenceFn: (recognizer: GestureRecognizer) => {
        predicted: string;
        inferenceTimeMs: number;
        confidence: number;
        reason: string;
      }
    ) => {
      sampleCounter++;
      const sampleId = `SAMPLE_${String(sampleCounter).padStart(4, '0')}`;
      const recognizer = new GestureRecognizer();
      recognizer.setInteractionSettings('med', false, true, true);

      const trial = sequenceFn(recognizer);
      const isCorrect = trial.predicted === groundTruth ? 1 : 0;

      results.push({
        sample_id: sampleId,
        ground_truth: groundTruth,
        predicted_label: trial.predicted,
        is_correct: isCorrect,
        confidence: trial.confidence,
        inference_time_ms: Number(trial.inferenceTimeMs.toFixed(3)),
        reason: trial.reason.replace(/,/g, ';'),
      });
    };

    // 1. CLASS: MOVE (Index pointing / relaxed cursor movement)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('MOVE', (recognizer) => {
        const isDegenerate = i >= 55; // 5 edge cases with extreme low confidence
        const conf = isDegenerate ? 0.45 : 0.95;
        const noiseLevel = 0.003 + (i % 5) * 0.003;
        const scale = 0.85 + (i % 5) * 0.07;
        const rotate = ((i % 7) - 3) * 4;
        const hand = perturbHand(createPointingHand(0.50), { noise: noiseLevel, scale, rotateDeg: rotate });

        const t0 = performance.now();
        const events = recognizer.update(hand, 0, conf);
        const elapsed = performance.now() - t0;
        const state = recognizer.getCurrentState();
        const diag = recognizer.getDiagnostics();

        let predicted = 'UNKNOWN';
        if (state === RecognizerState.MOVE && events.some((e) => e.type === 'HOVER_MOVE')) {
          predicted = 'MOVE';
        }

        return {
          predicted,
          inferenceTimeMs: elapsed,
          confidence: conf,
          reason: diag.reason,
        };
      });
    }

    // 2. CLASS: CLICK (Pinch thumb + index, hold 3 frames, release < 350ms)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('CLICK', (recognizer) => {
        const isDegenerate = i >= 55; // 5 edge cases held too long (>350ms)
        const pinchDuration = isDegenerate ? 450 : 120 + (i % 5) * 30;

        const pinchedHand = createSyntheticHand({
          [LANDMARK_INDEX.THUMB_TIP]: { x: 0.42, y: 0.31 },
          [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
        });
        const releasedHand = createSyntheticHand({
          [LANDMARK_INDEX.THUMB_TIP]: { x: 0.28, y: 0.52 },
          [LANDMARK_INDEX.INDEX_TIP]: { x: 0.42, y: 0.30 },
        });

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        allEvents.push(...recognizer.update(createPointingHand(), 0, 0.95));

        for (let f = 1; f <= 3; f++) {
          const t0 = performance.now();
          allEvents.push(...recognizer.update(pinchedHand, f * 30, 0.95));
          totalElapsed += performance.now() - t0;
        }

        const t0 = performance.now();
        allEvents.push(...recognizer.update(releasedHand, 90 + pinchDuration, 0.95));
        totalElapsed += performance.now() - t0;

        const hasClick = allEvents.some((e) => e.type === 'CLICK');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasClick ? 'CLICK' : 'MOVE',
          inferenceTimeMs: totalElapsed / 5,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 3. CLASS: SCROLL (Peace sign held for >= 3 frames)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('SCROLL', (recognizer) => {
        const isDegenerate = i >= 56; // 4 edge cases held only 2 frames (fails 3-frame hysteresis)
        const frameCount = isDegenerate ? 2 : 4;
        const peaceHand = createPeaceSignHand(0.50);

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        for (let f = 0; f < frameCount; f++) {
          const hand = perturbHand(peaceHand, { noise: 0.004, rotateDeg: ((i % 5) - 2) * 3 });
          const t0 = performance.now();
          allEvents.push(...recognizer.update(hand, f * 30, 0.95));
          totalElapsed += performance.now() - t0;
        }

        const state = recognizer.getCurrentState();
        const hasScroll = state === RecognizerState.SCROLLING || allEvents.some((e) => e.type === 'SCROLL_DELTA');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasScroll ? 'SCROLL' : 'MOVE',
          inferenceTimeMs: totalElapsed / frameCount,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 4. CLASS: REFRESH (Three fingers held for >= 3 frames)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('REFRESH', (recognizer) => {
        const isDegenerate = i >= 56; // 4 edge cases held only 2 frames
        const frameCount = isDegenerate ? 2 : 3;
        const threeHand = createThreeFingerHand();

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        for (let f = 0; f < frameCount; f++) {
          const hand = perturbHand(threeHand, { noise: 0.005 });
          const t0 = performance.now();
          allEvents.push(...recognizer.update(hand, f * 30, 0.95));
          totalElapsed += performance.now() - t0;
        }

        const hasRefresh = allEvents.some((e) => e.type === 'COMMAND' && e.command === 'REFRESH');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasRefresh ? 'REFRESH' : 'MOVE',
          inferenceTimeMs: totalElapsed / frameCount,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 5. CLASS: ZOOM_IN (Four fingers moving upward dy <= -0.035)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('ZOOM_IN', (recognizer) => {
        const isDegenerate = i >= 55; // 5 edge cases moving too little
        const targetPalmY = isDegenerate ? 0.485 : 0.32;

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        const t0 = performance.now();
        allEvents.push(...recognizer.update(createFourFingerHand(0.50), 0, 0.95));
        totalElapsed += performance.now() - t0;

        const t1 = performance.now();
        allEvents.push(...recognizer.update(createFourFingerHand(targetPalmY), 60, 0.95));
        totalElapsed += performance.now() - t1;

        const hasZoomIn = allEvents.some((e) => e.type === 'COMMAND' && e.command === 'ZOOM_IN');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasZoomIn ? 'ZOOM_IN' : 'MOVE',
          inferenceTimeMs: totalElapsed / 2,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 6. CLASS: ZOOM_OUT (Four fingers moving downward dy >= 0.035)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('ZOOM_OUT', (recognizer) => {
        const isDegenerate = i >= 55; // 5 edge cases moving too little
        const targetPalmY = isDegenerate ? 0.515 : 0.68;

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        const t0 = performance.now();
        allEvents.push(...recognizer.update(createFourFingerHand(0.50), 0, 0.95));
        totalElapsed += performance.now() - t0;

        const t1 = performance.now();
        allEvents.push(...recognizer.update(createFourFingerHand(targetPalmY), 60, 0.95));
        totalElapsed += performance.now() - t1;

        const hasZoomOut = allEvents.some((e) => e.type === 'COMMAND' && e.command === 'ZOOM_OUT');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasZoomOut ? 'ZOOM_OUT' : 'MOVE',
          inferenceTimeMs: totalElapsed / 2,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 7. CLASS: TOGGLE_KEYBOARD (Open five fingers moving horizontally |dx| >= 0.12)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('TOGGLE_KEYBOARD', (recognizer) => {
        const isDegenerate = i >= 55; // 5 edge cases moving too little (dx = 0.05 < 0.12)
        const targetPalmX = isDegenerate ? 0.44 : 0.65;

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        const coords = [0.40, 0.50, targetPalmX];
        for (let f = 0; f < coords.length; f++) {
          const t0 = performance.now();
          allEvents.push(...recognizer.update(createOpenHand(coords[f]), f * 30, 0.95));
          totalElapsed += performance.now() - t0;
        }

        const hasKeyboard = allEvents.some((e) => e.type === 'COMMAND' && e.command === 'TOGGLE_KEYBOARD');
        const diag = recognizer.getDiagnostics();

        return {
          predicted: hasKeyboard ? 'TOGGLE_KEYBOARD' : 'MOVE',
          inferenceTimeMs: totalElapsed / 3,
          confidence: 0.95,
          reason: diag.reason,
        };
      });
    }

    // 8. CLASS: UNKNOWN (Out-of-vocabulary postures: fist, rock sign, thumbs-up, sub-threshold confidence)
    for (let i = 0; i < SAMPLES_PER_CLASS; i++) {
      executeTrial('UNKNOWN', (recognizer) => {
        const oovType = i % 4;
        let hand: Point3D[];
        let confidence = 0.95;

        if (oovType === 0) {
          hand = createFistHand();
        } else if (oovType === 1) {
          hand = createRockSignHand();
        } else if (oovType === 2) {
          hand = createThumbsUpHand();
        } else {
          hand = createPointingHand();
          confidence = 0.35; // Below minConfidence 0.60
        }

        const allEvents: GestureEvent[] = [];
        let totalElapsed = 0;

        for (let f = 0; f < 3; f++) {
          const t0 = performance.now();
          allEvents.push(...recognizer.update(hand, f * 30, confidence));
          totalElapsed += performance.now() - t0;
        }

        const commands = allEvents.filter((e) => e.type === 'COMMAND');
        const clicks = allEvents.filter((e) => e.type === 'CLICK');
        const state = recognizer.getCurrentState();
        const diag = recognizer.getDiagnostics();

        let predicted = 'UNKNOWN';
        if (commands.length > 0 || clicks.length > 0 || state === RecognizerState.SCROLLING) {
          predicted = commands[0]?.type === 'COMMAND' ? (commands[0] as { command: string }).command : 'FALSE_TRIGGER';
        }

        return {
          predicted,
          inferenceTimeMs: totalElapsed / 3,
          confidence,
          reason: diag.reason,
        };
      });
    }

    // Save predictions to CSV
    const csvHeader = 'sample_id,ground_truth,predicted_label,is_correct,confidence,inference_time_ms,reason\n';
    const csvRows = results
      .map(
        (r) =>
          `${r.sample_id},${r.ground_truth},${r.predicted_label},${r.is_correct},${r.confidence},${r.inference_time_ms},"${r.reason}"`
      )
      .join('\n');

    const outPath = path.resolve(process.cwd(), 'metrics/data/evaluation_predictions.csv');
    fs.writeFileSync(outPath, csvHeader + csvRows, 'utf-8');

    expect(results.length).toBe(SAMPLES_PER_CLASS * 8);
    expect(fs.existsSync(outPath)).toBe(true);

    const totalCorrect = results.filter((r) => r.is_correct === 1).length;
    const accuracy = totalCorrect / results.length;
    console.log(`[Benchmark] Generated ${results.length} trials. Accuracy: ${(accuracy * 100).toFixed(2)}%`);
  });
});
