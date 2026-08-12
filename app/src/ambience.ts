/**
 * Room tone for the screens that are not slot machines.
 *
 * ## Why this is separate from `useSoundSet`
 *
 * A slot machine declares a whole palette — spin, stops, lever, win, fanfare,
 * scatter, near-miss — and its music arrives as one field of that. Everywhere
 * else in the app there is no palette to declare: the lobby has no reels to
 * stop, the roulette table has its own four recordings wired by hand, and an
 * instant game has one button. Routing those through `useSoundSet` would mean
 * inventing an empty set for each of them just to carry a single URL, and
 * would clear whatever set the last game installed as a side effect.
 *
 * So this does one thing: play a bed while a screen is mounted, and stop when
 * it is not.
 *
 * ## Why the lobby was silent
 *
 * Nothing outside the slot screen ever asked for a bed, and nothing outside a
 * game screen ever called `unlock()`. Both had to change: the bed is requested
 * here, and `unlockOnFirstGesture` makes the player's first touch anywhere
 * start the audio context. A room that is only quiet because the browser has
 * not been asked properly is indistinguishable from a room with no music.
 */

import { useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { playBed, stopBedIfPlaying, unlock, unlockOnFirstGesture } from './sound';

/**
 * The lobby, store and wallet share one bed.
 *
 * They are the same place as far as a player is concerned — the parts of the
 * app that are not a game — and crossfading between three different tracks
 * while somebody flicks between tabs would be worse than any one of them.
 * `bed-neon` is the brightest of the six families, which is the right register
 * for a room you are choosing a game in rather than playing one.
 */
export const LOBBY_BED = '/audio/bed-neon-2.mp3';

/**
 * Play a bed while this screen has focus, and stop when it loses it.
 *
 * FOCUS, not mount. Every tab in a bottom-tab navigator stays mounted once it
 * has been visited, so a mount-scoped effect would leave the lobby's music
 * playing underneath a game that had installed its own — two beds at once, and
 * the game's would be the quieter of them.
 */
export function useAmbientBed(url: string | null): void {
  useEffect(() => {
    unlockOnFirstGesture();
  }, []);

  /*
   * The `useCallback` is load-bearing, not tidiness: `useFocusEffect` re-runs
   * its effect whenever the function identity changes, so an inline arrow would
   * restart the music on every render of the screen.
   */
  useFocusEffect(
    useCallback(() => {
      if (!url) return undefined;
      unlock();
      playBed(url);
      // Only ever silences THIS screen's bed — see stopBedIfPlaying for the
      // navigation race that made the roulette table silent.
      return () => stopBedIfPlaying(url);
    }, [url]),
  );
}

/**
 * The roulette table.
 *
 * `bed-classic` rather than the lobby's neon: this is the oldest game in the
 * building and it should not sound like the arcade next door. Kept distinct
 * from the lobby's so that walking to the table is audibly arriving somewhere.
 */
export const ROULETTE_BED = '/audio/bed-classic-3.mp3';

/**
 * The instant games — crash, limbo, dice, plinko, mines.
 *
 * One bed across all five, because they are one family: no reels, no cards,
 * one number climbing or one grid being cleared. `bed-deep` is the least
 * melodic of the six, which is what a game with a rising multiplier needs —
 * anything with a tune fights the tension the number is building.
 */
export const INSTANT_BED = '/audio/bed-deep-2.mp3';

/**
 * The blackjack table.
 *
 * The same `bed-classic` family as roulette — they are two tables in the same
 * room and should sound like it — but a different track, so walking from one to
 * the other is audibly moving rather than the music simply continuing.
 */
export const BLACKJACK_BED = '/audio/bed-classic-1.mp3';
