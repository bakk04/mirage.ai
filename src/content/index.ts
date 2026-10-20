/**
 * AirBrowse - Content Script Orchestrator
 * Connects MediaPipe HandLandmarker, 3-gesture state machine (MOVE, CLICK, SCROLL),
 * On-Screen Floating Toolbar, Virtual Keyboard, and Cursor Overlay.
 *
 * Strict TypeScript: NO `any`.
 */

import { initializeCamera, stopCamera } from '../core/camera';
import { initializeHandLandmarker } from '../core/mediapipe';
import { GestureRecognizer, GestureEvent, RecognizerState } from '../core/gestures';
import { InteractionEngine } from '../core/interaction';
import {
  loadConfig,
  AirBrowseConfig,
  DEFAULT_CONFIG,
  MESSAGE_TYPES,
} from '../core/config';
import { SpatialOverlay } from './overlay';
import { ToolbarUI, ToolbarAction } from '../ui/Toolbar';
import { KeyboardUI } from '../ui/Keyboard';
import { extractMainText } from './extractor';
import type { HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

const AIRBROWSE_BUILD_ID = 'gesture-controls-2026-10-20';

class AirBrowseContentPipeline {
  private video: HTMLVideoElement | null = null;
  private landmarker: HandLandmarker | null = null;
  private animationFrameId: number | null = null;
  private lastVideoTime = -1;
  private lastInferenceTimestamp = -Infinity;
  private consecutiveInferenceErrors = 0;
  private isRunning = false;

  // Configuration
  private config: AirBrowseConfig = { ...DEFAULT_CONFIG };

  // Core engines
  private readonly gestureRecognizer: GestureRecognizer;
  private readonly interactionEngine: InteractionEngine;
  private readonly overlay: SpatialOverlay;
  private readonly toolbar: ToolbarUI;
  private readonly keyboard: KeyboardUI;

  // Active hand tracking & Telemetry
  private lastTrackedPalm: { x: number; y: number } | null = null;
  private latencySamples: number[] = [];
  private diagnostic = {
    camera: 'OFF',
    mediapipe: 'OFF',
    hands: 0,
    landmarks: 'INVALID',
    gesture: 'IDLE',
    lastCommand: 'none',
    commandResult: 'none',
    error: '',
    confidence: 0,
    stabilityFrames: 0,
    reason: 'Waiting for a valid hand',
  };
  private loggedVideoDimensions = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.airbrowseBuild = AIRBROWSE_BUILD_ID;
    }
    this.gestureRecognizer = new GestureRecognizer();
    this.interactionEngine = new InteractionEngine();
    this.overlay = new SpatialOverlay();

    this.toolbar = new ToolbarUI({
      onAction: (action) => this.handleToolbarAction(action),
    });

    this.keyboard = new KeyboardUI();
  }

  public async start(): Promise<void> {
    try {
      this.config = await loadConfig();
      this.gestureRecognizer.setInteractionSettings(
        this.config.cursorSmoothing,
        this.config.leftHandedMode,
        this.config.enableRefreshGesture,
        this.config.enableDangerousGestures
      );
      console.log('[AirBrowse] Initialized with config:', this.config);

      this.attachMessageListener();
      this.attachDOMEvents();

      if (!this.config.isEnabled) {
        console.log('[AirBrowse] Extension is disabled by configuration. Standing by.');
        return;
      }

      await this.resume();

      window.addEventListener('beforeunload', () => this.teardown(), { once: true });
      window.addEventListener('pagehide', () => this.teardown(), { once: true });
    } catch (error) {
      console.error('[AirBrowse] Startup error:', error);
      this.pause();
    }
  }

  public async resume(): Promise<void> {
    if (this.isRunning) return;

    try {
      if (!this.landmarker) {
        console.log('[AirBrowse] Loading offline MediaPipe HandLandmarker...');
        this.landmarker = await initializeHandLandmarker();
        this.diagnostic.mediapipe = 'READY';
        console.log('[AirBrowse] HandLandmarker ready.');
      }

      console.log('[AirBrowse] Requesting webcam stream...');
      this.video = await initializeCamera({
        onDisconnect: () => {
          console.warn('[AirBrowse] Webcam disconnected. Pausing pipeline.');
          this.pause();
        },
      });
      this.diagnostic.camera = 'READY';
      console.log('[AirBrowse] Webcam active.');

      this.isRunning = true;
      this.toolbar.setVisible(true);
      this.loop = this.loop.bind(this);
      this.animationFrameId = requestAnimationFrame(this.loop);
    } catch (error) {
      this.diagnostic.error = error instanceof Error ? error.message : String(error);
      this.diagnostic.camera = this.video ? 'ERROR' : this.diagnostic.camera;
      this.diagnostic.mediapipe = this.landmarker ? 'READY' : 'ERROR';
      console.error('[AirBrowse] Failed to resume pipeline:', error);
      this.pause();
    }
  }

  public pause(): void {
    this.isRunning = false;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.video) {
      stopCamera(this.video);
      this.video = null;
    }
    this.diagnostic.camera = 'OFF';
    this.diagnostic.hands = 0;
    this.diagnostic.landmarks = 'INVALID';
    this.diagnostic.confidence = 0;
    this.diagnostic.stabilityFrames = 0;
    this.diagnostic.reason = 'Camera stopped';
    this.lastVideoTime = -1;
    this.lastInferenceTimestamp = -Infinity;
    this.consecutiveInferenceErrors = 0;

    this.gestureRecognizer.reset();
    this.interactionEngine.stopScrolling();
    this.overlay.hide();
    this.toolbar.setVisible(false);
    this.overlay.cancelDwellProgress();
    this.toolbar.clearHover();
    this.keyboard.clearHover();

    console.log('[AirBrowse] Pipeline paused.');
  }

  public async updateConfig(newConfig: AirBrowseConfig): Promise<void> {
    const wasEnabled = this.config.isEnabled;
    this.config = { ...newConfig };
    this.gestureRecognizer.setInteractionSettings(
      this.config.cursorSmoothing,
      this.config.leftHandedMode,
      this.config.enableRefreshGesture,
      this.config.enableDangerousGestures
    );

    if (!wasEnabled && this.config.isEnabled) {
      await this.resume();
    } else if (wasEnabled && !this.config.isEnabled) {
      this.pause();
    }
  }

  private attachMessageListener(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (typeof message === 'object' && message !== null) {
        const msg = message as { type?: string; payload?: AirBrowseConfig };

        if (msg.type === MESSAGE_TYPES.CONFIG_UPDATED && msg.payload) {
          this.updateConfig(msg.payload)
            .then(() => sendResponse({ success: true, active: this.isRunning }))
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              sendResponse({ success: false, error: message, active: this.isRunning });
            });
          return true;
        }

        if (msg.type === 'EXTRACT_TEXT') {
          const text = extractMainText();
          sendResponse({ text });
          return true;
        }

        if (msg.type === 'TOGGLE_KEYBOARD') {
          this.keyboard.toggle();
          sendResponse({ success: true, open: this.keyboard.isOpen });
          return true;
        }
      }
      return false;
    });
  }

  private attachDOMEvents(): void {
    window.addEventListener('airbrowse:open-keyboard', () => {
      this.keyboard.open();
    });

    window.addEventListener('airbrowse:toggle-keyboard', () => {
      this.keyboard.toggle();
    });
  }

  private handleToolbarAction(action: ToolbarAction): void {
    switch (action) {
      case 'BACK':
        this.overlay.showToast('Back');
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'GO_BACK' });
        } else {
          window.history.back();
        }
        break;

      case 'FORWARD':
        this.overlay.showToast('Forward');
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'GO_FORWARD' });
        } else {
          window.history.forward();
        }
        break;

      case 'REFRESH':
        this.overlay.showToast('Refreshed');
        window.location.reload();
        break;

      case 'SCROLL_UP':
        this.overlay.showToast('Scroll Up');
        window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
        break;

      case 'SCROLL_DOWN':
        this.overlay.showToast('Scroll Down');
        window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
        break;

      case 'ZOOM_IN':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(
            { type: 'ZOOM', delta: 0.1 },
            (res?: { success: boolean; zoom?: number }) => {
              if (res?.zoom) {
                this.overlay.showToast(`Zoom ${Math.round(res.zoom * 100)}%`);
              }
            }
          );
        }
        break;

      case 'ZOOM_OUT':
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage(
            { type: 'ZOOM', delta: -0.1 },
            (res?: { success: boolean; zoom?: number }) => {
              if (res?.zoom) {
                this.overlay.showToast(`Zoom ${Math.round(res.zoom * 100)}%`);
              }
            }
          );
        }
        break;

      case 'NEW_TAB':
        this.overlay.showToast('New Tab');
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'NEW_TAB', openMode: this.config.openMode });
        }
        break;

      case 'CLOSE_TAB':
        this.overlay.showToast('Closing Tab');
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'CLOSE_TAB' });
        }
        break;

      case 'KEYBOARD':
        this.keyboard.toggle();
        this.overlay.showToast(this.keyboard.isOpen ? 'Keyboard Opened' : 'Keyboard Closed');
        break;
    }
  }

  private loop(timestamp: number): void {
    if (!this.isRunning || !this.video || !this.landmarker) {
      return;
    }

    if (
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0 &&
      timestamp - this.lastInferenceTimestamp >= 33 &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.lastInferenceTimestamp = timestamp;
      try {
        if (!this.loggedVideoDimensions) {
          console.info('[AirBrowse] Sending non-square webcam frames to MediaPipe:', {
            width: this.video.videoWidth,
            height: this.video.videoHeight,
            aspectRatio: this.video.videoWidth / this.video.videoHeight,
          });
          this.loggedVideoDimensions = true;
        }
        const tStart = performance.now();
        const results = this.landmarker.detectForVideo(this.video, timestamp);
        const latencyMs = performance.now() - tStart;
        if (this.latencySamples.length < 500) {
          this.latencySamples.push(latencyMs);
        }

        let handLandmarks: NormalizedLandmark[] | null = null;
        let confidence = 1.0;
        this.diagnostic.hands = results.landmarks?.length ?? 0;

        if (results.landmarks && results.landmarks.length > 0) {
          let chosenIndex = 0;
          if (results.landmarks.length > 1 && this.lastTrackedPalm !== null) {
            // Find hand closest to previous palm center to prevent hand-swapping glitches
            let bestDist = Infinity;
            for (let i = 0; i < results.landmarks.length; i++) {
              const palm = results.landmarks[i][9];
              if (palm) {
                const d = Math.hypot(palm.x - this.lastTrackedPalm.x, palm.y - this.lastTrackedPalm.y);
                if (d < bestDist) {
                  bestDist = d;
                  chosenIndex = i;
                }
              }
            }
          } else if (results.landmarks.length > 1 && results.handedness) {
            // Pick hand with highest confidence score
            let bestScore = -1;
            for (let i = 0; i < results.landmarks.length; i++) {
              const score = results.handedness[i]?.[0]?.score ?? 0;
              if (score > bestScore) {
                bestScore = score;
                chosenIndex = i;
              }
            }
          }

          handLandmarks = results.landmarks[chosenIndex];
          if (results.handedness && results.handedness[chosenIndex] && results.handedness[chosenIndex].length > 0) {
            confidence = results.handedness[chosenIndex][0].score;
          }

          if (handLandmarks && handLandmarks[9]) {
            this.lastTrackedPalm = { x: handLandmarks[9].x, y: handLandmarks[9].y };
          }
          this.diagnostic.landmarks =
            handLandmarks?.length === 21 &&
            handLandmarks.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
              ? 'VALID'
              : 'INVALID';
        } else {
          this.lastTrackedPalm = null;
          this.diagnostic.landmarks = 'INVALID';
        }

        // 1. Process frame through finite state machine
        const events: GestureEvent[] = this.gestureRecognizer.update(
          handLandmarks,
          timestamp,
          confidence
        );
        const gestureDiagnostics = this.gestureRecognizer.getDiagnostics();
        this.diagnostic.confidence = gestureDiagnostics.confidence;
        this.diagnostic.stabilityFrames = gestureDiagnostics.stabilityFrames;
        this.diagnostic.reason = gestureDiagnostics.reason;
        this.diagnostic.error = '';
        this.consecutiveInferenceErrors = 0;

        const currentState = this.gestureRecognizer.getCurrentState();
        this.diagnostic.gesture = currentState;
        this.updateDebugHUD(currentState, latencyMs);

        if (currentState === RecognizerState.IDLE) {
          this.overlay.hide();
          this.overlay.cancelDwellProgress();
          this.toolbar.clearHover();
          this.keyboard.clearHover();
          this.interactionEngine.stopScrolling();
        } else {
          // 2. Cursor position: smoothed landmark 9 mapped to full screen
          const screenNorm = this.gestureRecognizer.getScreenCursor();
          const screenPxX = Math.round(screenNorm.x * window.innerWidth);
          const screenPxY = Math.round(screenNorm.y * window.innerHeight);

          // Update visual cursor (white dot / shrinking / blue dot)
          this.overlay.updateCursor(screenPxX, screenPxY, currentState);

          // 3. Hit-test On-Screen Toolbar for dwell
          const toolbarRes = this.keyboard.isOpen
            ? { consumed: false }
            : this.toolbar.updateCursor(screenPxX, screenPxY, timestamp);

          // 4. Hit-test Virtual Keyboard for dwell
          const keyboardRes = this.keyboard.isOpen
            ? this.keyboard.updateCursor(screenPxX, screenPxY, timestamp)
            : { consumed: false };

          // Visual dwell feedback on cursor
          if (toolbarRes.dwellProgress !== undefined && toolbarRes.dwellProgress > 0) {
            this.overlay.showDwellProgress(toolbarRes.dwellProgress);
          } else if (keyboardRes.dwellProgress !== undefined && keyboardRes.dwellProgress > 0) {
            this.overlay.showDwellProgress(keyboardRes.dwellProgress);
          } else {
            this.overlay.cancelDwellProgress();
          }

          // 5. Dispatch Gesture Events
          for (const ev of events) {
            switch (ev.type) {
              case 'CLICK': {
                // Click coordinates are pre-pinch coordinates (frozen 100 ms prior)
                const clickPxX = Math.round(ev.x * window.innerWidth);
                const clickPxY = Math.round(ev.y * window.innerHeight);

                // Priority 1: Toolbar button quick pinch click
                const consumedByToolbar = this.toolbar.handleClick(clickPxX, clickPxY, timestamp);
                if (consumedByToolbar) break;

                // Priority 2: Virtual Keyboard key quick pinch click
                const consumedByKeyboard =
                  this.keyboard.isOpen && this.keyboard.handleClick(clickPxX, clickPxY, timestamp);
                if (consumedByKeyboard) break;

                // Priority 3: Underlying webpage DOM click
                // Auto-opens virtual keyboard if target is editable!
                const clickCount = this.config.clickMode === 'double' ? 2 : 1;
                let clickSucceeded = true;
                for (let clickIndex = 0; clickIndex < clickCount; clickIndex++) {
                  clickSucceeded = this.interactionEngine.triggerClick(clickPxX, clickPxY, () => {
                    this.keyboard.open();
                  }) && clickSucceeded;
                }
                this.diagnostic.lastCommand = `${this.config.clickMode} click`;
                this.diagnostic.commandResult = clickSucceeded ? 'SUCCESS' : 'FAILED';
                break;
              }

              case 'SCROLL_DELTA':
                const sensitivityScale = this.config.scrollSensitivity / DEFAULT_CONFIG.scrollSensitivity;
                this.interactionEngine.scrollByJoystick(
                  ev.speed * sensitivityScale,
                  screenPxX,
                  screenPxY
                );
                break;

              case 'SCROLL_END':
                this.interactionEngine.stopScrolling();
                break;

              case 'COMMAND':
                if (ev.command === 'REFRESH') {
                  this.dispatchCommand('REFRESH', 'Refresh');
                } else if (ev.command === 'CLOSE_WINDOW') {
                  this.dispatchCommand('CLOSE_WINDOW', 'Close window');
                } else if (ev.command === 'TOGGLE_KEYBOARD') {
                  this.keyboard.toggle();
                  this.diagnostic.lastCommand = 'TOGGLE_KEYBOARD';
                  this.diagnostic.commandResult = 'SUCCESS';
                  this.overlay.showToast(this.keyboard.isOpen ? 'Keyboard opened' : 'Keyboard closed');
                } else if (ev.command === 'ZOOM_IN' || ev.command === 'ZOOM_OUT') {
                  this.dispatchZoom(ev.command === 'ZOOM_IN' ? 0.1 : -0.1);
                }
                break;

              case 'HOVER_MOVE':
              case 'STATE_CHANGE':
              default:
                break;
            }
          }
        }

      } catch (inferenceError) {
        this.consecutiveInferenceErrors++;
        this.diagnostic.error = inferenceError instanceof Error
          ? inferenceError.message
          : String(inferenceError);
        console.error('[AirBrowse] Vision inference error:', {
          error: inferenceError,
          consecutiveErrors: this.consecutiveInferenceErrors,
          videoTime: this.video.currentTime,
        });
      }
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private updateDebugHUD(state: string, latencyMs: number): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const isHudEnabled = Boolean((window as unknown as { __AIRBROWSE_DEBUG_HUD__?: boolean }).__AIRBROWSE_DEBUG_HUD__);
    let hud = document.getElementById('airbrowse-debug-hud');
    const debugEnabled = isHudEnabled || localStorage.getItem('airbrowse_debug') === '1';
    if (!debugEnabled) {
      if (hud) hud.remove();
      return;
    }
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'airbrowse-debug-hud';
      Object.assign(hud.style, {
        position: 'fixed',
        bottom: '12px',
        left: '12px',
        zIndex: '2147483647',
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#10b981',
        padding: '6px 12px',
        borderRadius: '6px',
        fontFamily: 'monospace',
        fontSize: '11px',
        pointerEvents: 'none',
        lineHeight: '1.4',
        border: '1px solid rgba(255, 255, 255, 0.15)',
      });
      document.body.appendChild(hud);
    }
    const fps = Math.round(1000 / Math.max(1, latencyMs));
    hud.textContent = [
      `AirBrowse ${AIRBROWSE_BUILD_ID} | Camera: ${this.diagnostic.camera} | MediaPipe: ${this.diagnostic.mediapipe}`,
      `Hands: ${this.diagnostic.hands} | Landmarks: ${this.diagnostic.landmarks} | Confidence: ${this.diagnostic.confidence.toFixed(2)}`,
      `Gesture: ${state} | Stable: ${this.diagnostic.stabilityFrames} | ${this.diagnostic.reason}`,
      `Last: ${this.diagnostic.lastCommand} (${this.diagnostic.commandResult})`,
      `Inference: ${latencyMs.toFixed(1)}ms (${fps}fps)${this.diagnostic.error ? ` | Error: ${this.diagnostic.error}` : ''}`,
    ].join('\n');
  }

  private dispatchCommand(command: 'REFRESH' | 'CLOSE_WINDOW', label: string): void {
    this.diagnostic.lastCommand = command;
    this.diagnostic.commandResult = 'PENDING';
    chrome.runtime.sendMessage({ type: command }, (response?: { success?: boolean; error?: string }) => {
      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message ?? 'Runtime message failed';
        this.diagnostic.commandResult = `FAILED: ${message}`;
        this.diagnostic.error = message;
        return;
      }

      if (response?.success) {
        this.diagnostic.commandResult = 'SUCCESS';
        this.overlay.showToast(label);
      } else {
        this.diagnostic.commandResult = `FAILED: ${response?.error ?? 'No acknowledgement'}`;
        this.diagnostic.error = response?.error ?? 'No acknowledgement';
      }
    });
  }

  private dispatchZoom(delta: number): void {
    this.diagnostic.lastCommand = delta > 0 ? 'ZOOM_IN' : 'ZOOM_OUT';
    this.diagnostic.commandResult = 'PENDING';
    chrome.runtime.sendMessage({ type: 'ZOOM', delta }, (response?: { success?: boolean; zoom?: number; error?: string }) => {
      if (chrome.runtime.lastError) {
        const message = chrome.runtime.lastError.message ?? 'Zoom message failed';
        this.diagnostic.commandResult = `FAILED: ${message}`;
        this.diagnostic.error = message;
        return;
      }
      if (response?.success) {
        this.diagnostic.commandResult = 'SUCCESS';
        this.overlay.showToast(`Zoom ${Math.round((response.zoom ?? 1) * 100)}%`);
      } else {
        const message = response?.error ?? 'Zoom was not acknowledged';
        this.diagnostic.commandResult = `FAILED: ${message}`;
        this.diagnostic.error = message;
      }
    });
  }

  public teardown(): void {
    this.pause();

    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch (e) {
        console.warn('[AirBrowse] Error closing landmarker:', e);
      }
      this.landmarker = null;
    }

    this.overlay.destroy();
    this.toolbar.destroy();
    this.keyboard.destroy();
    console.log('[AirBrowse] Complete pipeline destroyed.');
  }
}

// Instantiate and start pipeline
const pipeline = new AirBrowseContentPipeline();
pipeline.start();
