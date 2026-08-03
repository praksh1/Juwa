/**
 * Sound effects, synthesised rather than sampled.
 *
 * WHY NOT AUDIO FILES
 *
 * The obvious route is a pack of .mp3s from a CC0 library (Kenney.nl and
 * OpenGameArt both have good ones, and they remain a sensible upgrade for a
 * richer palette later). Synthesis wins here for three reasons:
 *
 *  - **No licence question, ever.** These waveforms are generated at runtime.
 *    There is no attribution to track, no pack whose terms change, and nothing
 *    to re-clear if the app is ever sold.
 *  - **Nothing to download.** A casino app fires sounds constantly; a sample
 *    pack is hundreds of kilobytes a player waits for before the first spin.
 *    This is about 6KB of code.
 *  - **Tunable in one line.** "The reel click is too harsh" is a number here,
 *    not a trip back to a sound designer.
 *
 * The trade-off is honest: synthesised sounds are cleaner and thinner than
 * recorded ones. They read as arcade rather than as a Vegas floor. For a
 * free-to-play social casino that is a reasonable place to be, and swapping in
 * samples later means changing the bodies of these functions and nothing else.
 *
 * SAFARI, AND WHY `unlock()` EXISTS
 *
 * iOS will not let a page make noise until the user has interacted with it. An
 * AudioContext created on load starts `suspended` and every sound is silently
 * dropped — the single most common reason a web game is silent on iPhone. So
 * the context is created lazily and resumed from inside a real gesture.
 */

import { Platform } from 'react-native';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = false;

const MUTE_KEY = 'juwa.muted';
const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined';

function loadMute(): boolean {
  if (!isWeb()) return true;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
muted = loadMute();

function context(): Ctx | null {
  if (!isWeb()) return null;
  if (ctx) return ctx;

  const Impl =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Impl) return null;

  ctx = new Impl();
  master = ctx.createGain();
  // Headroom. Several effects can overlap during a bonus round, and summing
  // them at full volume clips into a nasty crackle.
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

/**
 * Call from inside a tap. Safe to call repeatedly.
 *
 * Creating the context here rather than at import time is deliberate: a context
 * created outside a gesture starts suspended on iOS and never recovers on its
 * own.
 */
export function unlock(): void {
  const audio = context();
  if (audio && audio.state === 'suspended') void audio.resume();
}

export function setMuted(next: boolean): void {
  muted = next;
  if (!isWeb()) return;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* private mode — the preference just does not persist */
  }
}

export function isMuted(): boolean {
  return muted;
}

// ----------------------------------------------------------------- building

/** A note with an attack-decay envelope. Everything below is made of these. */
function tone(
  freq: number,
  {
    type = 'sine',
    at = 0,
    duration = 0.15,
    gain = 0.5,
    sweepTo,
  }: {
    type?: OscillatorType;
    at?: number;
    duration?: number;
    gain?: number;
    sweepTo?: number;
  } = {},
): void {
  const audio = context();
  if (!audio || !master || muted) return;

  const start = audio.currentTime + at;
  const osc = audio.createOscillator();
  const env = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo !== undefined) {
    // Exponential ramps cannot pass through zero, hence the floor.
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), start + duration);
  }

  // A 4ms attack instead of an instant one. Starting a waveform at full
  // amplitude produces an audible click at the discontinuity.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Filtered white noise — the basis of clicks, swishes and card sounds. */
function noise({
  at = 0,
  duration = 0.05,
  gain = 0.3,
  frequency = 2000,
  q = 1,
  type = 'bandpass',
}: {
  at?: number;
  duration?: number;
  gain?: number;
  frequency?: number;
  q?: number;
  type?: BiquadFilterType;
} = {}): void {
  const audio = context();
  if (!audio || !master || muted) return;

  const start = audio.currentTime + at;
  const frames = Math.max(1, Math.floor(audio.sampleRate * duration));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const source = audio.createBufferSource();
  source.buffer = buffer;

  const filter = audio.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  const env = audio.createGain();
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(env).connect(master);
  source.start(start);
  source.stop(start + duration);
}

// ------------------------------------------------------------------ effects

export const sounds = {
  /** Any button. Short and bright so it reads as responsive, not as an event. */
  tap(): void {
    tone(660, { type: 'triangle', duration: 0.06, gain: 0.25 });
  },

  /** The reel starting to move: a soft rising whoosh. */
  spinStart(): void {
    noise({ duration: 0.35, gain: 0.14, frequency: 700, q: 0.7, type: 'lowpass' });
    tone(180, { type: 'sine', duration: 0.3, gain: 0.14, sweepTo: 420 });
  },

  /**
   * A reel landing. Called five times, staggered.
   *
   * A click plus a low thump — the mechanical sound is most of why a slot feels
   * physical rather than like a spreadsheet updating.
   */
  reelStop(index = 0): void {
    noise({ duration: 0.035, gain: 0.3, frequency: 2600, q: 1.6 });
    // Each reel lands slightly lower than the last, so the run has a shape.
    tone(150 - index * 8, { type: 'sine', duration: 0.09, gain: 0.32 });
  },

  /** A modest win: a short major third. */
  win(): void {
    tone(523.25, { type: 'triangle', duration: 0.12, gain: 0.35 });
    tone(659.25, { type: 'triangle', at: 0.08, duration: 0.16, gain: 0.35 });
  },

  /** A big win: a rising arpeggio with a shimmer on top. */
  bigWin(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      tone(freq, { type: 'triangle', at: i * 0.09, duration: 0.3, gain: 0.34 });
      tone(freq * 2, { type: 'sine', at: i * 0.09, duration: 0.22, gain: 0.1 });
    });
  },

  /** Coins landing. Deliberately metallic and slightly detuned. */
  coins(count = 5): void {
    for (let i = 0; i < count; i++) {
      const at = i * 0.055 + Math.random() * 0.02;
      tone(1400 + Math.random() * 700, { type: 'square', at, duration: 0.05, gain: 0.1 });
      noise({ at, duration: 0.03, gain: 0.07, frequency: 5000, q: 2 });
    }
  },

  /** Free spins triggered — the biggest moment in the base game. */
  bonus(): void {
    tone(392, { type: 'sawtooth', duration: 0.5, gain: 0.22, sweepTo: 1568 });
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((freq, i) => {
      tone(freq, { type: 'triangle', at: 0.35 + i * 0.07, duration: 0.35, gain: 0.3 });
    });
  },

  /** A card sliding out of the shoe. */
  cardDeal(): void {
    noise({ duration: 0.09, gain: 0.16, frequency: 3200, q: 0.8 });
  },

  /** A card turning over: sharper and shorter than the deal. */
  cardFlip(): void {
    noise({ duration: 0.05, gain: 0.2, frequency: 1800, q: 1.2 });
    tone(320, { type: 'sine', duration: 0.05, gain: 0.12 });
  },

  /** A hand lost. Quiet and low — losing is the common case and must not nag. */
  lose(): void {
    tone(220, { type: 'sine', duration: 0.18, gain: 0.16, sweepTo: 150 });
  },

  /** Something went wrong. */
  error(): void {
    tone(180, { type: 'square', duration: 0.12, gain: 0.18 });
  },
};

/** Test seam: lets the browser check the context actually started. */
export function audioState(): string | null {
  return ctx?.state ?? null;
}
