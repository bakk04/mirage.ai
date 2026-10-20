/**
 * AirBrowse - Camera Capture Module
 * Safely requests webcam stream (video-only) and initializes a hidden HTMLVideoElement.
 */

export interface CameraConfig {
  width?: number;
  height?: number;
  frameRate?: number;
  /** Invoked when webcam stream is abruptly terminated or disconnected by hardware/OS */
  onDisconnect?: () => void;
}

export class CameraAccessError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = 'CameraAccessError';
  }
}

/**
 * Initializes webcam capture and returns an active, auto-playing HTMLVideoElement.
 * Throws explicit errors if access is denied or hardware is unavailable.
 */
export async function initializeCamera(config: CameraConfig = {}): Promise<HTMLVideoElement> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraAccessError(
      'MediaDevices API (getUserMedia) is not supported in this browser or context.'
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: config.width ?? 640 },
      height: { ideal: config.height ?? 480 },
      frameRate: { ideal: config.frameRate ?? 30 },
    },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error: unknown) {
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          throw new CameraAccessError(
            'Camera access denied: User or system permission blocked.',
            error
          );
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          throw new CameraAccessError(
            'Camera hardware not found: No available webcam detected.',
            error
          );
        case 'NotReadableError':
        case 'TrackStartError':
          throw new CameraAccessError(
            'Camera hardware is already in use by another application or process.',
            error
          );
        case 'OverconstrainedError':
          throw new CameraAccessError(
            'Camera does not satisfy the specified media constraints.',
            error
          );
        default:
          throw new CameraAccessError(
            `Camera initialization failed (${error.name}): ${error.message}`,
            error
          );
      }
    }
    throw new CameraAccessError('Unexpected error occurred while acquiring camera stream.', error);
  }

  // Create dynamically a hidden video element to feed frames to vision models
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;

  // Keep element in document tree with 0 opacity to ensure Chromium decodes frames reliably
  video.style.position = 'fixed';
  video.style.top = '0';
  video.style.left = '0';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  video.style.zIndex = '-9999';
  video.setAttribute('aria-hidden', 'true');
  document.body.appendChild(video);

  video.srcObject = stream;

  // Monitor tracks for hardware disconnection or permission revocation
  if (config.onDisconnect) {
    const handleTrackEnded = () => {
      config.onDisconnect?.();
    };
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', handleTrackEnded, { once: true });
    });
  }

  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const cleanupAfterFailure = (error: unknown): void => {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      video.remove();
      reject(error);
    };

    const handleLoadedData = async () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
      try {
        await video.play();
        resolve(video);
      } catch (playError) {
        cleanupAfterFailure(new CameraAccessError('Failed to start webcam video playback.', playError));
      }
    };

    const handleError = (e: Event) => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
      cleanupAfterFailure(new CameraAccessError('Error encountered on HTMLVideoElement stream decoding.', e));
    };

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      video
        .play()
        .then(() => resolve(video))
        .catch((err) => {
          cleanupAfterFailure(new CameraAccessError('Failed to start webcam video playback.', err));
        });
    } else {
      video.addEventListener('loadeddata', handleLoadedData);
      video.addEventListener('error', handleError);
    }
  });
}

/**
 * Cleanly stops all tracks and removes the video element from the DOM.
 */
export function stopCamera(video: HTMLVideoElement): void {
  if (video.srcObject instanceof MediaStream) {
    video.srcObject.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
  video.remove();
}
