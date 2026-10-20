/**
 * AirBrowse - TensorFlow.js CNN Inference Engine (Audited & Hardened)
 * Manages loading, memory lifecycle, and forward-pass inference for local EMNIST models.
 * Enforces strict tensor scoping (tf.engine().startScope / endScope) to guarantee zero memory leaks.
 */

import * as tf from '@tensorflow/tfjs';

export const EMNIST_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;

export interface TensorMemoryProfile {
  numTensors: number;
  numBytes: number;
  unreliable?: boolean;
}

/**
 * Maps predicted class index to corresponding English letter (A-Z).
 * Supports both 0-indexed (26 classes) and 1-indexed (27 classes with 0 as background).
 */
export function mapClassToCharacter(classIndex: number, totalClasses: number = 26): string {
  if (totalClasses === 27) {
    if (classIndex >= 1 && classIndex <= 26) {
      return EMNIST_LETTERS[classIndex - 1];
    }
    return '';
  }

  if (classIndex >= 0 && classIndex < 26) {
    return EMNIST_LETTERS[classIndex];
  }

  return '';
}

export class CNNPredictor {
  public isReady = false;
  private model: tf.LayersModel | null = null;
  private isLoading = false;

  /**
   * Loads the local LayersModel from public/models/cnn/model.json.
   * Handles errors gracefully if the model files are not yet deployed.
   */
  public async initialize(modelPath?: string): Promise<boolean> {
    if (this.isReady && this.model) {
      return true;
    }

    if (this.isLoading) {
      return false;
    }

    this.isLoading = true;

    const url =
      modelPath ??
      (typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('models/cnn/model.json')
        : '/models/cnn/model.json');

    try {
      console.log(`[AirBrowse] Loading local CNN model from: ${url}`);
      this.model = await tf.loadLayersModel(url);
      this.isReady = true;
      console.log('[AirBrowse] TensorFlow.js EMNIST CNN model successfully initialized.');
      return true;
    } catch {
      this.model = null;
      this.isReady = false;
      console.warn('[AirBrowse] CNN model missing. Air Writing is disabled.');
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Runs forward-pass inference on a 784-element (28x28) Float32Array.
   * Enforces strict tf.engine().startScope() and endScope() boundaries to eliminate WebGL leaks.
   */
  public predictLetter(normalizedData: Float32Array): string {
    if (!this.isReady) return '';
    if (!this.model) return '';

    if (normalizedData.length !== 784) {
      console.warn(
        `[AirBrowse] Invalid trajectory data length: expected 784 (28x28), received ${normalizedData.length}.`
      );
      return '';
    }

    let predictedChar = '';

    // Enforce strict memory scope boundary
    tf.engine().startScope();
    try {
      // 1. Reshape 1D vector into 4D tensor: [batch=1, height=28, width=28, channels=1]
      const inputTensor = tf.tensor4d(normalizedData, [1, 28, 28, 1], 'float32');

      // 2. Execute CNN prediction
      const prediction = this.model.predict(inputTensor) as tf.Tensor;

      // 3. Extract class with highest probability
      const argMaxTensor = prediction.argMax(-1);
      const classIndices = argMaxTensor.dataSync();
      const classIndex = classIndices[0];
      const totalClasses = prediction.shape[1] ?? 26;

      // 4. Map class index to alphabet letter
      predictedChar = mapClassToCharacter(classIndex, totalClasses);
    } catch (error) {
      console.error('[AirBrowse] TensorFlow.js prediction encountered an error:', error);
    } finally {
      // Aggressively dispose of all intermediate tensors created in this scope
      tf.engine().endScope();
    }

    return predictedChar;
  }

  /**
   * Returns current active WebGL tensor memory profiling information.
   */
  public getMemoryProfile(): TensorMemoryProfile {
    const mem = tf.memory();
    return {
      numTensors: mem.numTensors,
      numBytes: mem.numBytes,
      unreliable: mem.unreliable,
    };
  }

  /**
   * Releases WebGL GPU memory allocated by the loaded model and forces scope cleanup.
   */
  public dispose(): void {
    if (this.model) {
      this.model.dispose();
      this.model = null;
      this.isReady = false;
      console.log('[AirBrowse] TensorFlow.js CNN model memory disposed.');
    }
  }
}

// Export aliases for backwards compatibility across existing orchestrator imports
export { CNNPredictor as CNNInferenceEngine };
