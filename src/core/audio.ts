/**
 * AirBrowse - UI Audio Feedback Engine
 * Generates programmatic, lightweight tactile sound effects via Web Audio API.
 * Complies strictly with Chrome autoplay policies via lazy initialization upon user interaction.
 */

let audioCtx: AudioContext | null = null;

/**
 * Initializes or unlocks the shared AudioContext following user interaction.
 */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      // Context resume is blocked until genuine user interaction occurs
    });
  }

  return audioCtx;
}

// Attach one-time event listeners for early unlock upon the first user interaction
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    getAudioContext();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('click', unlockAudio);
  };

  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });
  window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  window.addEventListener('click', unlockAudio, { once: true, passive: true });
}

/**
 * Dispatches a subtle, satisfying mechanical click/pop sound effect.
 * Synthesized purely with a sine wave oscillator and an exponential decay volume envelope.
 */
export function playClickSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';

    // Pitch envelope: subtle pitch drop from 850Hz to 220Hz creates a crisp physical click
    osc.frequency.setValueAtTime(850, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.04);

    // Amplitude envelope: instant soft attack with rapid exponential fade-out
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.05);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  } catch (err) {
    // Graceful degradation if audio output is unavailable
    console.debug('[AirBrowse] Audio click failed:', err);
  }
}
