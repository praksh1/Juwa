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

/**
 * Two channels, muted independently.
 *
 * They are genuinely different preferences and one switch could not express
 * either. Music is the thing somebody turns off to listen to something else
 * while they play; effects are the thing somebody turns off in a waiting room.
 * A single toggle forces a player who wants their own music to give up the
 * reels landing as well, and most simply mute the whole tab instead — at which
 * point every sound decision in this product is moot.
 *
 * `music` is the looping bed. `effects` is everything else: reels, wins, taps,
 * the counter tick, the lever.
 */
export type SoundChannel = 'music' | 'effects';

const MUTE_KEY: Record<SoundChannel, string> = {
  // The original key, kept for `effects` so an existing player who muted the
  // app does not have it come back on after this change.
  effects: 'juwa.muted',
  music: 'juwa.muted.music',
};

const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined';

function loadMute(channel: SoundChannel): boolean {
  // Off the web there is no Web Audio at all, so everything is muted.
  if (!isWeb()) return true;
  try {
    return window.localStorage.getItem(MUTE_KEY[channel]) === '1';
  } catch {
    return false;
  }
}

const muteState: Record<SoundChannel, boolean> = {
  effects: loadMute('effects'),
  music: loadMute('music'),
};

/** Effects are checked on every one-shot; kept as a plain read for brevity. */
const effectsMuted = () => muteState.effects;

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

/**
 * Unlock on the player's first touch ANYWHERE, once.
 *
 * ## The problem it solves
 *
 * Every browser refuses to start audio outside a user gesture, so `unlock()`
 * has to be called from inside a tap. Until now the only things that called it
 * were the spin controls and the felt — which is fine for a slot machine and
 * useless for a room tone, because the lobby's music is meant to be playing
 * BEFORE the player commits to anything. The bed would be requested, the
 * context would still be suspended, and the lobby was silent until the player
 * entered a game and came back.
 *
 * Listening at the document means the gesture that unlocks the audio is
 * whatever the player did first — scrolling the lobby, tapping a tile, opening
 * a tab — rather than a specific control we remembered to wire up.
 *
 * Registered once and removed on the first event. `capture` and `passive` so it
 * cannot interfere with anything it observes: this listener must be incapable
 * of changing the behaviour of the app it is attached to.
 */
let armed = false;
export function unlockOnFirstGesture(): void {
  if (armed || typeof document === 'undefined') return;
  armed = true;

  const fire = () => {
    unlock();
    for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
      document.removeEventListener(type, fire, { capture: true });
    }
  };
  for (const type of ['pointerdown', 'touchstart', 'keydown'] as const) {
    document.addEventListener(type, fire, { capture: true, passive: true });
  }
}

/**
 * Anything that wants to re-render when a toggle moves.
 *
 * The state lives in this module rather than in React, because the audio graph
 * needs it on every sample and a hook cannot be read from `playSample`. The
 * listeners are how a switch on screen stays in step with it.
 */
const muteListeners = new Set<() => void>();

export function onMuteChange(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export function setMuted(channel: SoundChannel, next: boolean): void {
  muteState[channel] = next;

  // The bed is the one sound already playing when this is called; every effect
  // simply checks the flag the next time it fires.
  if (channel === 'music' && bedGain && ctx) {
    bedGain.gain.cancelScheduledValues(ctx.currentTime);
    bedGain.gain.setValueAtTime(Math.max(0.0001, bedGain.gain.value), ctx.currentTime);
    bedGain.gain.exponentialRampToValueAtTime(next ? 0.0001 : BED_GAIN, ctx.currentTime + 0.4);
  }

  for (const listener of muteListeners) listener();

  if (!isWeb()) return;
  try {
    window.localStorage.setItem(MUTE_KEY[channel], next ? '1' : '0');
  } catch {
    /* private mode — the preference just does not persist */
  }
}

export function isMuted(channel: SoundChannel): boolean {
  return muteState[channel];
}

// ------------------------------------------------------------------ samples

/**
 * Recorded sound, layered over the synthesised sound below.
 *
 * ## Why both, rather than replacing one with the other
 *
 * The synthesised effects are good at the SHORT mechanical things — a reel
 * click, a counter tick, a button — because those need to fire at an exact
 * instant, five or fifty times a spin, with no attack delay and no file to
 * fetch first. They are bad at the big moments, where a player expects a
 * recorded fanfare and a square wave sounds like a toy.
 *
 * So the samples take the moments and the synthesiser keeps the mechanics. A
 * sample that has not finished loading falls back to its synthesised version
 * rather than playing nothing: a spin must never be silent because a network
 * request was slow.
 *
 * ## Decoding before the first gesture
 *
 * `decodeAudioData` works on a suspended context, so the whole set can be
 * fetched and decoded while the player is still reading the rules card. Only
 * PLAYBACK needs the context running, which is what `unlock()` is for.
 */
const sampleBuffers = new Map<string, AudioBuffer>();
const sampleLoads = new Map<string, Promise<void>>();

/** Below this a sample is silence as far as anybody listening is concerned. */
const SILENCE = 0.006;
/**
 * Kept in front of the first audible sample.
 *
 * Cutting exactly on the threshold clips the very start of the transient, which
 * on a click is most of what makes it a click.
 */
const PREROLL_MS = 4;

/**
 * Cut the silence off both ends of a decoded sample.
 *
 * ## Why this is not optional
 *
 * A generator pads its output to a round length. Of the reel-stop recordings,
 * one carries 374 MILLISECONDS of silence before the click and 1.36 seconds
 * after it — and a reel stop is booked to fire at the exact instant the reel
 * lands. Played untrimmed, every fifth reel would click a third of a second
 * late, which is not a subtle defect: it is the sound arriving after the
 * picture. The coin tick is worse in a different way — two seconds of file for
 * eighty milliseconds of sound, fifteen times a second during a roll-up.
 *
 * Doing it here rather than in the files means the uploads stay exactly as they
 * were generated. Nothing is re-encoded, nothing loses quality, and a
 * regenerated file needs no preparation before it is dropped in.
 */
function trimSilence(audio: Ctx, buffer: AudioBuffer): AudioBuffer {
  const channels = buffer.numberOfChannels;
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  const loud = (i: number) => {
    for (let c = 0; c < channels; c++) if (Math.abs(data[c]![i]!) > SILENCE) return true;
    return false;
  };

  let first = 0;
  while (first < buffer.length && !loud(first)) first++;
  // Entirely silent. Hand it back untouched rather than build a zero-length
  // buffer, which throws.
  if (first >= buffer.length) return buffer;

  let last = buffer.length - 1;
  while (last > first && !loud(last)) last--;

  const preroll = Math.round((PREROLL_MS / 1000) * buffer.sampleRate);
  const start = Math.max(0, first - preroll);
  const length = last - start + 1;
  if (length >= buffer.length - preroll) return buffer;

  const out = audio.createBuffer(channels, length, buffer.sampleRate);
  for (let c = 0; c < channels; c++) {
    out.getChannelData(c).set(data[c]!.subarray(start, start + length));
  }
  return out;
}

export function preloadSample(url: string): Promise<void> {
  if (sampleBuffers.has(url)) return Promise.resolve();
  const already = sampleLoads.get(url);
  if (already) return already;
  const audio = context();
  if (!audio) return Promise.resolve();

  const load = fetch(url)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((bytes) => audio.decodeAudioData(bytes))
    .then((buffer) => {
      sampleBuffers.set(url, trimSilence(audio, buffer));
    })
    .catch(() => {
      // A missing or undecodable sound must never break a spin. The caller
      // falls back to the synthesised version and nobody hears a problem.
      sampleLoads.delete(url);
    });

  sampleLoads.set(url, load);
  return load;
}

export function preloadSamples(urls: readonly string[]): Promise<void> {
  return Promise.all(urls.map(preloadSample)).then(() => undefined);
}

/**
 * Play a decoded sample. Returns false if it was not ready, so the caller can
 * fall back rather than drop the sound.
 */
function playSample(
  url: string | undefined,
  {
    when,
    gain = 0.55,
    rate = 1,
    tail,
  }: {
    when?: number;
    gain?: number;
    rate?: number;
    /**
     * Play only the LAST `tail` seconds.
     *
     * For the anticipation riser, which has to climax exactly as the reel
     * lands. The hold is 0.6 seconds and the recording is three, so playing it
     * from the start would leave it still climbing after the reel had stopped,
     * and speeding it up five-fold turns a riser into a chirp. Starting it
     * partway in plays its most intense stretch and resolves on the beat.
     */
    tail?: number;
  } = {},
): boolean {
  if (!url) return false;
  const audio = context();
  if (!audio || !master || effectsMuted()) return false;

  const buffer = sampleBuffers.get(url);
  if (!buffer) {
    void preloadSample(url);
    return false;
  }

  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const env = audio.createGain();
  env.gain.value = gain;
  source.connect(env);
  env.connect(master);

  const at = Math.max(audio.currentTime, when ?? audio.currentTime);
  const offset = tail === undefined ? 0 : Math.max(0, buffer.duration - tail);
  source.start(at, offset);
  return true;
}

/* -------------------------------------------------------------- music bed */

let bedSource: AudioBufferSourceNode | null = null;
let bedGain: GainNode | null = null;
/** The bed most recently REQUESTED — may still be downloading. */
let bedUrl: string | null = null;
/** The bed actually SOUNDING right now. See playBed for why these differ. */
let bedPlaying: string | null = null;

/** How long a bed takes to arrive and to leave. */
const BED_FADE = 1.2;
/**
 * Music sits well under the effects.
 *
 * A bed the player notices is a bed that is too loud: its whole job is to make
 * a room feel like a place, and it competes with every sound that carries
 * information — the reel stops, the counter, the win.
 */
const BED_GAIN = 0.22;

/**
 * Start a looping music bed, crossfading from whatever was playing.
 *
 * Idempotent on the same URL, which matters because the screen re-runs its
 * effect on every re-render: restarting the music each time the balance
 * changed would be a stutter every spin.
 *
 * ## The bug that made every bed after the first one silent
 *
 * There used to be one variable for two different facts — what has been ASKED
 * for and what is actually SOUNDING — and the difference between them is the
 * whole of this function, because a bed that is not in the cache has to be
 * fetched first.
 *
 * The sequence was:
 *
 *   playBed(table)   buffer missing -> start fetch, set bedUrl = table, return
 *   fetch resolves   -> playBed(table)
 *                    -> `bedUrl === url && bedSource` is now TRUE, because
 *                       bedUrl was set optimistically and bedSource is still
 *                       the LOBBY's source -> return, having played nothing.
 *
 * So the first bed of a session played (there was no bedSource to trip the
 * guard) and every bed after it was dropped on the floor. The lobby had music,
 * the roulette table did not, and neither did any slot machine — which is
 * exactly what the founder kept reporting, and which I had twice attributed to
 * something else.
 *
 * `bedPlaying` is what is sounding; `bedUrl` is what was last requested. The
 * guard reads the first, the fetch callback reads the second.
 */
export function playBed(url: string): void {
  if (bedPlaying === url && bedSource) return;
  const audio = context();
  if (!audio || !master) return;

  const buffer = sampleBuffers.get(url);
  if (!buffer) {
    // Fetch it, then come back. A 700KB bed is not worth blocking anything for.
    bedUrl = url;
    void preloadSample(url).then(() => {
      // Only if this is still the bed anybody wants: a player who opened a
      // game and left again before the download finished must not have the
      // music of a screen they are no longer on start up underneath them.
      if (bedUrl === url) playBed(url);
    });
    return;
  }

  stopBed();
  bedUrl = url;
  bedPlaying = url;

  const gain = audio.createGain();
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  // The BED is music, so it follows the music channel, not effects.
  gain.gain.exponentialRampToValueAtTime(
    muteState.music ? 0.0001 : BED_GAIN,
    audio.currentTime + BED_FADE,
  );
  gain.connect(master);

  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain);
  source.start();

  bedSource = source;
  bedGain = gain;
}

/**
 * Loop a sound effect for as long as something is happening, and stop it.
 *
 * ## Why this had to exist
 *
 * `roulette-ball-roll.mp3` is ONE SECOND long. The ball runs for three and a
 * half. Firing it once at the tap gave a second of rattle followed by two and a
 * half seconds of silence and then, out of nowhere, the drop — which is exactly
 * what "the spin and stop sounds feel out of sync" describes. Nothing was
 * mistimed; there was simply no sound for most of the spin, so the drop had
 * nothing to be the end OF.
 *
 * A looping source fixes it properly: the rattle runs for as long as the ball
 * does, whatever that turns out to be, and the caller stops it at the moment
 * the ball lands. It is on the EFFECTS channel, not music, because it is a
 * thing happening rather than a room tone.
 *
 * Returns its own stop function. Calling it twice is safe.
 */
export function playLoop(url: string, gain = 0.4, rate = 1): () => void {
  const audio = context();
  if (!audio || !master || effectsMuted()) return () => {};

  const buffer = sampleBuffers.get(url);
  if (!buffer) {
    /*
     * Not loaded yet. Start it as soon as it is — unless the caller has
     * already given up, which is what the flag is for. A spin that finishes
     * before the file arrives must not leave a rattle looping over an idle
     * table.
     */
    let abandoned = false;
    let stopLate: (() => void) | null = null;
    void preloadSample(url).then(() => {
      if (!abandoned) stopLate = playLoop(url, gain, rate);
    });
    return () => {
      abandoned = true;
      stopLate?.();
    };
  }

  const env = audio.createGain();
  // A short ramp in, so starting the loop is not a click.
  env.gain.setValueAtTime(0.0001, audio.currentTime);
  env.gain.exponentialRampToValueAtTime(gain, audio.currentTime + 0.08);
  env.connect(master);

  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.loop = true;
  source.connect(env);
  source.start();

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    // Ramped out over 120ms. Cutting a rattle dead is audible as an edit, and
    // this one ends underneath the drop, which would make it obvious.
    const end = audio.currentTime + 0.12;
    env.gain.cancelScheduledValues(audio.currentTime);
    env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), audio.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    try {
      source.stop(end + 0.02);
    } catch {
      // Already stopped.
    }
  };
}

/**
 * Stop the bed ONLY if the one playing is the one the caller started.
 *
 * ## Why the roulette table was silent
 *
 * Screens stop their own music on the way out. But React Navigation runs the
 * arriving screen's focus effect and the leaving screen's cleanup in an order
 * nobody controls, and the cleanup usually goes last. So opening roulette from
 * the lobby did this:
 *
 *     roulette focuses  -> playBed(bed-classic)
 *     lobby blurs       -> stopBed()            <- kills the roulette bed
 *
 * The lobby's music worked, the table's did not, and the reason was entirely
 * invisible from either screen: each one was correct on its own. The founder
 * reported the roulette table still had no music after it had been added, and
 * they were right.
 *
 * Making the stop conditional removes the ordering problem instead of trying to
 * win the race. A screen can only ever silence its OWN bed, so a late cleanup
 * from a screen that has already been replaced does nothing at all.
 */
export function stopBedIfPlaying(url: string): void {
  /*
   * `bedUrl`, not `bedPlaying`, and the distinction is the whole fix.
   *
   * `bedUrl` is the bed most recently REQUESTED by anybody. If it is still this
   * screen's, nothing has replaced us and we should go quiet. If it is not,
   * another screen has already asked for its own bed — possibly one that is
   * still downloading — and this cleanup must do nothing at all, because
   * `stopBed` clears the pending request and the arriving screen would be left
   * permanently silent.
   *
   * Matching on `bedPlaying` instead is what caused exactly that: the lobby's
   * cleanup ran while the table's bed was mid-download, stopped the lobby, and
   * wiped the pending url on the way past. The fetch then resolved into a
   * no-op and the roulette table had no music.
   *
   * Leaving the old bed running for the extra half second until the new one
   * arrives is the right trade: `playBed` crossfades, so what the player hears
   * is one room becoming another rather than a gap.
   */
  if (bedUrl === url) stopBed();
}

export function stopBed(): void {
  const audio = context();
  const source = bedSource;
  const gain = bedGain;
  bedSource = null;
  bedGain = null;
  bedUrl = null;
  bedPlaying = null;
  if (!source || !gain || !audio) return;

  // Faded rather than cut. A loop stopping dead is the most obvious edit there
  // is, and leaving the screen should not sound like a mistake.
  const end = audio.currentTime + BED_FADE * 0.5;
  gain.gain.cancelScheduledValues(audio.currentTime);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  try {
    source.stop(end + 0.05);
  } catch {
    // Already stopped. Nothing to do.
  }
}

/**
 * Which recordings the game currently on screen uses.
 *
 * One set at a time, swapped when a game is opened. Held here rather than
 * threaded through every call site because a sound effect has no business
 * being a prop: `sounds.win()` is called from six places and none of them
 * should have to know which cabinet they are inside.
 */
export interface SoundSet {
  /** The reels turning. */
  spin?: string;
  /** Seamless mechanical reel bed, held through an anticipation stop. */
  loop?: string;
  /** The handle, on the machines that have one. */
  lever?: string;
  /** An ordinary win. */
  win?: string;
  /** A big one. */
  big?: string;
  /** The largest. Longest file in the set. */
  mega?: string;
  /** A bonus round starting. */
  bonus?: string;
  /** The looping music underneath everything. */
  bed?: string;
  /**
   * Reel stops, one per reel.
   *
   * A LIST rather than one file, and it is the difference between a machine
   * with five reels and a machine with one moving part heard five times. Each
   * reel takes the entry at its own index.
   */
  stops?: readonly string[];
  /** The riser under a reel that could still complete a bonus. */
  tension?: string;
  /** A scatter landing. */
  scatter?: string;
  /** Two scatters and no third. */
  nearMiss?: string;
  /** A coin sticking during hold and spin. */
  coinLock?: string;
  /** Winning symbols clearing on a tumble. */
  cascade?: string;
  /** The counter rolling up. */
  tick?: string;
  /** Any button. */
  tap?: string;
}

/**
 * Fire one named recording directly.
 *
 * For the sounds that belong to a specific moment in a specific game rather
 * than to the six slots of a `SoundSet` — the roulette ball rattling into its
 * pocket, for instance. Silently does nothing if the file has not loaded, and
 * the caller is expected to have a synthesised effect alongside it, exactly as
 * the set-based effects do.
 */
export function playCue(url: string, gain = 0.6): void {
  playSample(url, { gain });
}

let currentSet: SoundSet = {};

// A spin has both an acceleration cue and a sustained mechanism. Keep the
// latter here so an interrupted round cannot leave it running under idle reels.
let stopReelLoop: (() => void) | null = null;
let reelLoopTimer: ReturnType<typeof setTimeout> | null = null;

function stopActiveReelLoop(): void {
  if (reelLoopTimer !== null) {
    clearTimeout(reelLoopTimer);
    reelLoopTimer = null;
  }
  stopReelLoop?.();
  stopReelLoop = null;
}

export function useSoundSet(set: SoundSet): void {
  currentSet = set;
  const urls: string[] = [];
  for (const value of Object.values(set)) {
    if (typeof value === 'string') urls.push(value);
    else if (Array.isArray(value)) urls.push(...value);
  }
  /*
   * The bed is fetched LAST and separately.
   *
   * It is 700KB against about 40KB for every effect put together, so loading it
   * in the same breath would delay the sounds a player hears in the first two
   * seconds behind the one they will not notice for thirty.
   */
  const bed = set.bed;
  void preloadSamples(urls.filter((u) => u !== bed)).then(() => {
    if (bed) void preloadSample(bed).then(() => { if (currentSet.bed === bed) playBed(bed); });
  });
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
    when,
  }: {
    type?: OscillatorType;
    at?: number;
    duration?: number;
    gain?: number;
    sweepTo?: number;
    when?: number;
  } = {},
): void {
  const audio = context();
  if (!audio || !master || effectsMuted()) return;

  // `when` is an ABSOLUTE time on the audio clock, for sounds booked in
  // advance; `at` is relative to now, for sounds fired in response to a tap.
  // Booking ahead is what keeps a scheduled sound exact — the browser hands it
  // to the audio thread, so it does not drift with a busy main thread.
  const start = Math.max(audio.currentTime, when ?? audio.currentTime + at);
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
  when,
}: {
  at?: number;
  duration?: number;
  gain?: number;
  frequency?: number;
  q?: number;
  type?: BiquadFilterType;
  when?: number;
} = {}): void {
  const audio = context();
  if (!audio || !master || effectsMuted()) return;

  const start = Math.max(audio.currentTime, when ?? audio.currentTime + at);
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
    if (playSample(currentSet.tap, { gain: 0.5 })) return;
    tone(660, { type: 'triangle', duration: 0.06, gain: 0.25 });
  },

  /** The reel starting to move: a soft rising whoosh. */
  spinStart(): void {
    stopActiveReelLoop();
    // The short sample gives the motor its pickup. The continuous loop arrives
    // after that attack at a lower level, so an anticipation hold stays alive
    // without turning into two full-volume whirrs at once.
    const played = playSample(currentSet.spin, { gain: 0.34 });
    if (currentSet.loop) {
      const loop = currentSet.loop;
      reelLoopTimer = setTimeout(() => {
        reelLoopTimer = null;
        stopReelLoop = playLoop(loop, 0.16);
      }, 720);
    }
    if (played) return;
    noise({ duration: 0.35, gain: 0.14, frequency: 700, q: 0.7, type: 'lowpass' });
    tone(180, { type: 'sine', duration: 0.3, gain: 0.14, sweepTo: 420 });
  },

  /** Fade the motor underneath the final reel's physical stop. */
  reelLoopStop(): void {
    stopActiveReelLoop();
  },

  /**
   * The handle being pulled.
   *
   * Its own effect rather than a variant of `spinStart`, because on a lever
   * machine the two are different moments: the mechanism engages under the
   * player's hand, and then the reels go.
   */
  lever(): void {
    if (playSample(currentSet.lever, { gain: 0.7 })) return;
    noise({ duration: 0.12, gain: 0.2, frequency: 900, q: 1.1 });
    tone(90, { type: 'square', duration: 0.16, gain: 0.22, sweepTo: 60 });
  },

  /**
   * A reel landing. Called five times, staggered.
   *
   * A click plus a low thump — the mechanical sound is most of why a slot feels
   * physical rather than like a spreadsheet updating.
   */
  reelStop(index = 0): void {
    if (playSample(currentSet.stops?.[index % (currentSet.stops.length || 1)], { gain: 0.85 })) return;
    noise({ duration: 0.035, gain: 0.3, frequency: 2600, q: 1.6 });
    // Each reel lands slightly lower than the last, so the run has a shape.
    tone(150 - index * 8, { type: 'sine', duration: 0.09, gain: 0.32 });
  },

  /**
   * A reel landing, BOOKED IN ADVANCE at an absolute time on the audio clock.
   *
   * This is the half of "one clock" that the sound owns. The reel animation
   * computes its position from `spinNow()`, which is this same clock, and the
   * stop is scheduled for the exact instant the animation reaches its end. Both
   * therefore refer to one timeline rather than two that agree only at the
   * start — which is what made the old version drift by the network round trip.
   */
  reelStopAt(index: number, when: number): void {
    const stops = currentSet.stops;
    if (stops?.length && playSample(stops[index % stops.length], { when, gain: 0.85 })) return;
    noise({ when, duration: 0.035, gain: 0.3, frequency: 2600, q: 1.6 });
    tone(150 - index * 8, { when, type: 'sine', duration: 0.09, gain: 0.32 });
  },

  /**
   * The anticipation tone under a reel that could still complete a win.
   *
   * Rises across the extended spin so the tension resolves exactly as the reel
   * lands. Also booked in advance, for the same reason.
   */
  tensionAt(when: number, duration: number): void {
    // `tail` so the riser CLIMAXES as the reel lands rather than starting there
    // — see the note on `playSample`.
    if (playSample(currentSet.tension, { when, gain: 0.6, tail: duration })) return;
    tone(220, { when, type: 'sawtooth', duration, gain: 0.1, sweepTo: 880 });
    noise({ when, duration, gain: 0.05, frequency: 1200, q: 0.6, type: 'bandpass' });
  },

  /** A scatter landing — the symbol that triggers everything. */
  scatter(): void {
    if (playSample(currentSet.scatter, { gain: 0.7 })) return;
    tone(880, { type: 'triangle', duration: 0.18, gain: 0.3 });
    tone(1320, { type: 'sine', at: 0.06, duration: 0.22, gain: 0.18 });
  },

  /**
   * Two scatters and no third.
   *
   * Marked because real cabinets mark it, and kept QUIET because a near miss is
   * a loss. A machine that celebrates one is telling the player something that
   * is not true.
   */
  nearMiss(): void {
    if (playSample(currentSet.nearMiss, { gain: 0.4 })) return;
    tone(400, { type: 'triangle', duration: 0.3, gain: 0.14, sweepTo: 280 });
  },

  /** A coin sticking during hold and spin. */
  coinLock(): void {
    if (playSample(currentSet.coinLock, { gain: 0.6 })) return;
    noise({ duration: 0.06, gain: 0.24, frequency: 3200, q: 1.4 });
    tone(210, { type: 'square', duration: 0.12, gain: 0.26, sweepTo: 150 });
  },

  /** Winning symbols clearing on a tumble. */
  cascade(): void {
    if (playSample(currentSet.cascade, { gain: 0.6 })) return;
    noise({ duration: 0.12, gain: 0.16, frequency: 4200, q: 1.1 });
  },

  /**
   * One tick of the coin counter.
   *
   * Very short and very quiet: this fires a dozen times a second during a
   * roll-up, and anything with a tail turns into a buzz rather than a count.
   */
  tick(): void {
    if (playSample(currentSet.tick, { gain: 0.3, rate: 0.95 + Math.random() * 0.1 })) return;
    tone(1800 + Math.random() * 300, { type: 'square', duration: 0.02, gain: 0.06 });
  },

  /** A modest win: a short major third. */
  win(): void {
    if (playSample(currentSet.win)) return;
    tone(523.25, { type: 'triangle', duration: 0.12, gain: 0.35 });
    tone(659.25, { type: 'triangle', at: 0.08, duration: 0.16, gain: 0.35 });
  },

  /** A big win: a rising arpeggio with a shimmer on top. */
  bigWin(): void {
    if (playSample(currentSet.big)) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      tone(freq, { type: 'triangle', at: i * 0.09, duration: 0.3, gain: 0.34 });
      tone(freq * 2, { type: 'sine', at: i * 0.09, duration: 0.22, gain: 0.1 });
    });
  },

  /**
   * A mega win: the big-win arpeggio extended up two octaves.
   *
   * Built from the same notes rather than a new motif, so the biggest moment
   * sounds like more of the thing the player already associates with winning
   * instead of like a different machine.
   */
  megaWin(): void {
    if (playSample(currentSet.mega, { gain: 0.6 })) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093];
    notes.forEach((freq, i) => {
      tone(freq, { type: 'triangle', at: i * 0.085, duration: 0.42, gain: 0.32 });
      tone(freq * 2, { type: 'sine', at: i * 0.085, duration: 0.3, gain: 0.09 });
    });
    tone(130.81, { type: 'sawtooth', duration: 0.9, gain: 0.16, sweepTo: 523.25 });
  },

  /** Coins landing. Deliberately metallic and slightly detuned. */
  coins(count = 5): void {
    /*
     * The coin animation is shared by the cabinets, but its voice is not.
     * `tick` belongs to the installed machine's sound set, so a dragon hoard
     * can chime differently from a neon game while the same coins visibly fly
     * to the balance. The synth below remains the no-download fallback.
     */
    const tick = currentSet.tick;
    for (let i = 0; i < count; i++) {
      const at = i * 0.055 + Math.random() * 0.02;
      if (tick) {
        setTimeout(() => {
          if (playSample(tick, { gain: 0.22, rate: 0.86 + Math.random() * 0.22 })) return;
          tone(1400 + Math.random() * 700, { type: 'square', duration: 0.05, gain: 0.1 });
          noise({ duration: 0.03, gain: 0.07, frequency: 5000, q: 2 });
        }, at * 1000);
      } else {
        tone(1400 + Math.random() * 700, { type: 'square', at, duration: 0.05, gain: 0.1 });
        noise({ at, duration: 0.03, gain: 0.07, frequency: 5000, q: 2 });
      }
    }
  },

  /** Free spins triggered — the biggest moment in the base game. */
  bonus(): void {
    if (playSample(currentSet.bonus, { gain: 0.6 })) return;
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

/**
 * The clock everything in a spin is measured against.
 *
 * `AudioContext.currentTime` when there is an audio context, because that is
 * the clock scheduled sounds actually run on. `performance.now()` otherwise —
 * on a device with no Web Audio, or before the first gesture has unlocked it,
 * there is no sound to be out of step with, so any monotonic clock will do.
 *
 * The rule is that the reels and the sounds must read the SAME function. A
 * reel animated off `requestAnimationFrame` deltas while its stop sound is
 * scheduled on the audio clock is two clocks, and they drift.
 */
export function spinNow(): number {
  const audio = context();
  if (audio) return audio.currentTime;
  if (isWeb() && typeof performance !== 'undefined') return performance.now() / 1000;
  return Date.now() / 1000;
}

/** Test seam: lets the browser check the context actually started. */
export function audioState(): string | null {
  return ctx?.state ?? null;
}
