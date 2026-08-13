/**
 * The win meter: a plaque with the total rolling up on it.
 *
 * ## Why the number needed a frame
 *
 * In the founder's reference video the amount is the hero of the screen — a
 * metal plaque with WIN METER stamped above it, big digits rolling, coins
 * raining onto it. In this app the same number was set in the UI's own face on
 * the celebration card, which is a *label*, and it lost every contest with the
 * painted banner sitting above it.
 *
 * A banner says what KIND of win it was. The meter says HOW MUCH, which is the
 * part the player is actually waiting for. Giving it a frame, an inset well and
 * digits half again as large is the difference between a caption and an
 * instrument.
 *
 * ## Why this is not a second counter
 *
 * It is the SAME counter, restyled. `SlotsScreen` already hides the readout
 * under the reels while a banner is up, because two counters rolling to one
 * total at slightly different rates reads as a bug. That rule has not changed;
 * this is the one that stayed.
 *
 * ## The digits do not move
 *
 * `tabular-nums` — inherited from the money type styles — so every digit is the
 * same width. Without it "1,111" and "8,888" are different lengths and a
 * roll-up jitters left and right for its whole duration, which is the one
 * artefact that makes a counter look cheap no matter how good the frame is.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { CoinCounter } from './CoinCounter';
import type { WinTier } from '../motion';

export function WinMeter({
  amount,
  tier,
  /** Louder for the bigger tiers, so the three moments are told apart. */
  label = 'WIN METER',
}: {
  amount: number;
  tier: WinTier;
  label?: string;
}) {
  const jackpot = tier === 'jackpot';
  const mega = tier === 'mega';

  return (
    <View style={styles.wrap}>
      {/*
        The bezel. Two gradients rather than one: a metal rim, and an inset
        well behind the digits. A single flat panel reads as a div with a
        border; the pair reads as something machined, because a real one is a
        plate with a window cut in it.
      */}
      <LinearGradient
        colors={
          jackpot
            ? ['#FFF6D8', '#C9A227', '#6B4E08']
            : mega
              ? ['#FFD9EC', '#C46098', '#4A1B33']
              : ['#F7E6A8', '#C8A44D', '#5A420C']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.bezel}
      >
        <View style={styles.well}>
          {/*
            The stamped caption. Small, wide-tracked and dim — it is a label
            engraved on the plate, not a thing to read.
          */}
          <Txt variant="caption" color="rgba(255,255,255,0.5)" style={styles.label}>
            {label}
          </Txt>
          <CoinCounter
            amount={amount}
            tier={tier}
            color={colors.text.primary}
            style={[styles.digits, jackpot ? styles.digitsJackpot : null]}
          />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', alignItems: 'center' },
  bezel: {
    borderRadius: radius.md,
    padding: 3,
    /*
     * The plate is as wide as the banner above it.
     *
     * It used to shrink-wrap its digits with a 280-point floor, so on a card
     * that had grown to 358 points the meter sat narrower than the art and the
     * two read as unrelated objects. A cabinet's meter is set into the same
     * fascia as its banner and is exactly as wide.
     */
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.45)',
  },
  well: {
    backgroundColor: 'rgba(6,4,12,0.88)',
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 1,
    // The lip of the cut-out, catching light along its top edge.
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.8)',
  },
  label: { letterSpacing: 3, fontSize: 12, lineHeight: 14, fontWeight: '800' },
  digits: {
    // 34 was smaller than the balance in the header, which is absurd for the
    // one number the whole celebration exists to announce. 52 fits "1,234,567"
    // inside a 358-point plate with room either side, which is the largest
    // total this game can pay at the maximum stake.
    fontSize: 52,
    lineHeight: 60,
    fontWeight: '900',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 214, 102, 0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  digitsJackpot: { fontSize: 58, lineHeight: 66 },
});
