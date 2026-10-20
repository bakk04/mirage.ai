/**
 * AirBrowse - Trajectory Normalization Engine
 * Processes raw air-writing coordinate trajectories into normalized 28x28 grayscale matrices
 * formatted as Float32Array inputs ready for EMNIST/MNIST CNN inference.
 */

export interface StrokePoint {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Computes the axis-aligned bounding box for a series of coordinate points.
 */
export function computeBoundingBox(points: StrokePoint[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// Reusable offscreen 28x28 canvas and rendering context
let sharedCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let sharedCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getOffscreenContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (sharedCtx) return sharedCtx;

  if (typeof OffscreenCanvas !== 'undefined') {
    sharedCanvas = new OffscreenCanvas(28, 28);
    sharedCtx = sharedCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 28;
    canvas.height = 28;
    sharedCanvas = canvas;
    sharedCtx = canvas.getContext('2d');
  }

  return sharedCtx;
}

/**
 * Normalizes an arbitrary stroke trajectory into a 28x28 grayscale Float32Array (784 floats).
 * Following the standard MNIST/EMNIST specification:
 * - Aspect ratio preserved
 * - Scaled to fit within a 20x20 inner bounding box
 * - Centered within the 28x28 matrix (leaving a 4px margin)
 * - Stroke values normalized between [0.0, 1.0] (0.0 = background, 1.0 = stroke)
 */
export function normalizeTrajectory(points: StrokePoint[]): Float32Array {
  const output = new Float32Array(28 * 28);

  if (!points || points.length === 0) {
    return output;
  }

  const bbox = computeBoundingBox(points);
  const maxDim = Math.max(bbox.width, bbox.height, 1);

  // Standard EMNIST scaling: fit into 20x20 area within 28x28 frame
  const scale = 20 / maxDim;
  const scaledWidth = bbox.width * scale;
  const scaledHeight = bbox.height * scale;

  // Center the scaled bounding box inside the 28x28 frame
  const offsetX = (28 - scaledWidth) / 2 - bbox.minX * scale;
  const offsetY = (28 - scaledHeight) / 2 - bbox.minY * scale;

  const ctx = getOffscreenContext();

  if (ctx) {
    // Canvas-accelerated anti-aliased rasterization
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 28, 28);

    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      const px = points[0].x * scale + offsetX;
      const py = points[0].y * scale + offsetY;
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x * scale + offsetX, points[0].y * scale + offsetY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * scale + offsetX, points[i].y * scale + offsetY);
      }
      ctx.stroke();
    }

    const imgData = ctx.getImageData(0, 0, 28, 28);
    for (let i = 0; i < 28 * 28; i++) {
      output[i] = imgData.data[i * 4] / 255.0;
    }
  } else {
    // Pure mathematical rasterization fallback for headless environments
    rasterizeMathematicalFallback(points, scale, offsetX, offsetY, output);
  }

  return output;
}

/**
 * Pure mathematical fallback for line rasterization when canvas is unavailable.
 */
function rasterizeMathematicalFallback(
  points: StrokePoint[],
  scale: number,
  offsetX: number,
  offsetY: number,
  output: Float32Array
): void {
  const radius = 1.2;

  const drawPoint = (cx: number, cy: number, intensity: number = 1.0) => {
    const minCol = Math.max(0, Math.floor(cx - radius));
    const maxCol = Math.min(27, Math.ceil(cx + radius));
    const minRow = Math.max(0, Math.floor(cy - radius));
    const maxRow = Math.min(27, Math.ceil(cy + radius));

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const dist = Math.hypot(c - cx, r - cy);
        if (dist <= radius) {
          const val = Math.max(0, 1 - dist / radius) * intensity;
          const idx = r * 28 + c;
          output[idx] = Math.min(1.0, output[idx] + val);
        }
      }
    }
  };

  for (let i = 0; i < points.length; i++) {
    const x1 = points[i].x * scale + offsetX;
    const y1 = points[i].y * scale + offsetY;

    if (i === 0) {
      drawPoint(x1, y1);
      continue;
    }

    const x0 = points[i - 1].x * scale + offsetX;
    const y0 = points[i - 1].y * scale + offsetY;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist * 2));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      drawPoint(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
}

/**
 * Alias for normalizeTrajectory.
 */
export const normalizeStroke = normalizeTrajectory;
