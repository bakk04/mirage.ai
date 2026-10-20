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

class AirBrowseContentPipeline {
  private video: HTMLVideoElement | null = null;
  private landmarker: HandLandmarker | null = null;
  private animationFrameId: number | null = null;
  private lastVideoTime = -1;
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

  constructor() {
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
        console.log('[AirBrowse] HandLandmarker ready.');
      }

      console.log('[AirBrowse] Requesting webcam stream...');
      this.video = await initializeCamera({
        onDisconnect: () => {
          console.warn('[AirBrowse] Webcam disconnected. Pausing pipeline.');
          this.pause();
        },
      });
      console.log('[AirBrowse] Webcam active.');

      this.isRunning = true;
      this.loop = this.loop.bind(this);
      this.animationFrameId = requestAnimationFrame(this.loop);
    } catch (error) {
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

    this.gestureRecognizer.reset();
    this.interactionEngine.stopScrolling();
    this.overlay.hide();
    this.overlay.cancelDwellProgress();
    this.toolbar.clearHover();
    this.keyboard.clearHover();

    console.log('[AirBrowse] Pipeline paused.');
  }

  public async updateConfig(newConfig: AirBrowseConfig): Promise<void> {
    const wasEnabled = this.config.isEnabled;
    this.config = { ...newConfig };

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
          this.updateConfig(msg.payload);
          sendResponse({ success: true });
          return true;
        }

        if (msg.type === 'EXTRACT_TEXT') {
          const text = extractMainText();
          sendResponse({ text });
          return true;
        }
      }
      return true;
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
          chrome.runtime.sendMessage({ type: 'NEW_TAB' });
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
      this.video.currentTime !== this.lastVideoTime
    ) {
      try {
        const tStart = performance.now();
        const results = this.landmarker.detectForVideo(this.video, timestamp);
        const latencyMs = performance.now() - tStart;
        if (this.latencySamples.length < 500) {
          this.latencySamples.push(latencyMs);
        }

        let handLandmarks: NormalizedLandmark[] | null = null;
        let confidence = 1.0;

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
        } else {
          this.lastTrackedPalm = null;
        }

        // 1. Process frame through finite state machine
        const events: GestureEvent[] = this.gestureRecognizer.update(
          handLandmarks,
          timestamp,
          confidence
        );

        const currentState = this.gestureRecognizer.getCurrentState();
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
          const toolbarRes = this.toolbar.updateCursor(screenPxX, screenPxY, timestamp);

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
                this.interactionEngine.triggerClick(clickPxX, clickPxY, () => {
                  this.keyboard.open();
                });
                break;
              }

              case 'SCROLL_DELTA':
                this.interactionEngine.scrollByJoystick(ev.speed, screenPxX, screenPxY);
                break;

              case 'SCROLL_END':
                this.interactionEngine.stopScrolling();
                break;

              case 'HOVER_MOVE':
              case 'STATE_CHANGE':
              default:
                break;
            }
          }
        }

        this.lastVideoTime = this.video.currentTime;
      } catch (inferenceError) {
        console.warn('[AirBrowse] Vision inference error:', inferenceError);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  private updateDebugHUD(state: string, latencyMs: number): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const isHudEnabled = Boolean((window as unknown as { __AIRBROWSE_DEBUG_HUD__?: boolean }).__AIRBROWSE_DEBUG_HUD__);
    let hud = document.getElementById('airbrowse-debug-hud');
    if (!isHudEnabled) {
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
    hud.textContent = `AirBrowse | State: ${state} | Latency: ${latencyMs.toFixed(1)}ms (${fps}fps)`;
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
