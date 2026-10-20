/**
 * AirBrowse - MediaPipe HandLandmarker Initialization Module
 * Resolves local offline .task and .wasm bundles inside Manifest V3 Chrome Extension.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

export interface HandLandmarkerConfig {
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
}

// ModuleFactory type definition
type ModuleFactoryFn = (moduleArg?: unknown) => Promise<unknown>;

/**
 * Pre-loads MediaPipe's Wasm ModuleFactory directly into the Content Script's isolated realm.
 *
 * ROOT CAUSE OF "ModuleFactory not set":
 * MediaPipe's default loader appends a <script> element to document.body.
 * In a Chrome Extension Content Script (isolated world), that injected script evaluates
 * inside the host webpage's Main World realm, leaving self.ModuleFactory undefined
 * in the Content Script's Isolated World realm.
 *
 * By dynamically importing the ES module version of the wasm loader into the Content Script,
 * we ensure ModuleFactory is bound directly to the isolated global scope (self / globalThis).
 */
async function loadIsolatedModuleFactory(
  wasmBasePath: string
): Promise<ModuleFactoryFn | null> {
  const globalObj = (typeof globalThis !== 'undefined' ? globalThis : self) as Record<string, unknown>;

  if (typeof globalObj.ModuleFactory === 'function') {
    return globalObj.ModuleFactory as ModuleFactoryFn;
  }

  // 1. Dynamic ES module import from extension package
  try {
    const moduleUrl = `${wasmBasePath}vision_wasm_module_internal.js`;
    console.info('[AirBrowse] Pre-loading Wasm ModuleFactory via dynamic import:', moduleUrl);
    const mod = await import(/* @vite-ignore */ moduleUrl);
    const factory =
      (mod?.default as ModuleFactoryFn) ||
      (mod?.ModuleFactory as ModuleFactoryFn) ||
      (globalObj.ModuleFactory as ModuleFactoryFn);

    if (typeof factory === 'function') {
      globalObj.ModuleFactory = factory;
      (self as unknown as Record<string, unknown>).ModuleFactory = factory;
      console.info('[AirBrowse] Wasm ModuleFactory successfully bound to isolated world.');
      return factory;
    }
  } catch (esmError) {
    console.warn('[AirBrowse] Dynamic ES module import failed, attempting fallback:', esmError);
  }

  // 2. Blob fallback if direct URL import is restricted by page CSP
  try {
    const moduleUrl = `${wasmBasePath}vision_wasm_module_internal.js`;
    const response = await fetch(moduleUrl);
    const code = await response.text();
    const blob = new Blob([code], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      const mod = await import(/* @vite-ignore */ blobUrl);
      const factory =
        (mod?.default as ModuleFactoryFn) ||
        (mod?.ModuleFactory as ModuleFactoryFn) ||
        (globalObj.ModuleFactory as ModuleFactoryFn);

      if (typeof factory === 'function') {
        globalObj.ModuleFactory = factory;
        (self as unknown as Record<string, unknown>).ModuleFactory = factory;
        console.info('[AirBrowse] Wasm ModuleFactory bound via Blob fallback.');
        return factory;
      }
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } catch (blobError) {
    console.warn('[AirBrowse] Blob import fallback also failed:', blobError);
  }

  return null;
}

/**
 * Initializes MediaPipe HandLandmarker using local offline assets.
 * Adheres strictly to Chrome Extension Manifest V3 CSP constraints.
 */
export async function initializeHandLandmarker(
  config: HandLandmarkerConfig = {}
): Promise<HandLandmarker> {
  const wasmPath = chrome.runtime.getURL('models/wasm/');
  console.info('[AirBrowse] Resolving Vision Tasks WASM bundle from:', wasmPath);

  // Pre-load ModuleFactory into Content Script isolated realm
  const factory = await loadIsolatedModuleFactory(wasmPath);

  // Use module fileset (maps to vision_wasm_module_internal.wasm)
  const vision = await FilesetResolver.forVisionTasks(wasmPath, true);

  // If ModuleFactory is bound in isolated realm, clear wasmLoaderPath.
  // This prevents MediaPipe from appending a redundant/failing <script> tag into host document.body.
  if (factory) {
    vision.wasmLoaderPath = '';
  }

  const modelAssetPath = chrome.runtime.getURL('models/hand_landmarker.task');
  console.info('[AirBrowse] Resolving HandLandmarker task model from:', modelAssetPath);

  const options = {
    runningMode: 'VIDEO' as const,
    numHands: config.numHands ?? 2,
    minHandDetectionConfidence: config.minHandDetectionConfidence ?? 0.5,
    minHandPresenceConfidence: config.minHandPresenceConfidence ?? 0.5,
    minTrackingConfidence: config.minTrackingConfidence ?? 0.5,
  };

  // Helper: MediaPipe clears self.ModuleFactory to undefined after each instantiation attempt.
  // We re-bind it before each attempt so GPU fallback to CPU retains the factory.
  const rebindFactory = () => {
    if (factory) {
      const globalObj = (typeof globalThis !== 'undefined' ? globalThis : self) as Record<string, unknown>;
      globalObj.ModuleFactory = factory;
      (self as unknown as Record<string, unknown>).ModuleFactory = factory;
      vision.wasmLoaderPath = '';
    }
  };

  try {
    console.info('[AirBrowse] Attempting HandLandmarker initialization with GPU delegate...');
    rebindFactory();
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath,
        delegate: 'GPU',
      },
    });
    console.info('[AirBrowse] HandLandmarker initialized successfully with GPU delegate.');
    return landmarker;
  } catch (gpuError) {
    console.warn(
      '[AirBrowse] GPU delegate initialization failed, falling back to CPU runtime:',
      gpuError
    );

    rebindFactory();
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath,
        delegate: 'CPU',
      },
    });
    console.info('[AirBrowse] HandLandmarker initialized successfully with CPU delegate.');
    return landmarker;
  }
}
