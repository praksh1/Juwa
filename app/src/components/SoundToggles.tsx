/**
 * Music and effects, switchable independently, wherever you are.
 *
 * ## Why in the game and not only in settings
 *
 * The moment somebody wants the sound off is the moment it is annoying them,
 * and that moment happens during a spin — not while browsing a settings screen
 * two taps away. A mute that can only be reached by leaving the game is a mute
 * most players never find; they mute the browser tab instead, which silences
 * every sound decision in the product at once and permanently.
 *
 * ## Why two switches and not one
 *
 * They are different preferences. Music is what you turn off to listen to
 * something else while you play; effects are what you turn off in a waiting
 * room. One switch makes a player who wants their own music give up the reels
 * landing as well.
 *
 * ## Why it subscribes
 *
 * The mute state lives in the audio module, because `playSample` has to read it
 * on every one-shot and cannot read a React hook. `onMuteChange` is what keeps
 * a switch on this screen in step with one on another — the Profile toggle and
 * the in-game toggle are the same preference and must never disagree.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { isMuted, onMuteChange, setMuted, sounds, unlock, type SoundChannel } from '../sound';

/** Live view of one channel's mute state, wherever it was changed from. */
export function useMuted(channel: SoundChannel): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => isMuted(channel));
  useEffect(() => onMuteChange(() => setValue(isMuted(channel))), [channel]);
  return [
    value,
    (next: boolean) => {
      setMuted(channel, next);
      // Unmuting is a gesture, and a gesture is the only moment iOS will let an
      // audio context start. Confirming audibly also proves it worked.
      if (!next) {
        unlock();
        if (channel === 'effects') sounds.tap();
      }
    },
  ];
}

const ICONS: Record<SoundChannel, { on: 'musical-notes' | 'volume-high'; off: 'musical-notes-outline' | 'volume-mute-outline' }> = {
  music: { on: 'musical-notes', off: 'musical-notes-outline' },
  effects: { on: 'volume-high', off: 'volume-mute-outline' },
};

const LABELS: Record<SoundChannel, string> = {
  music: 'Background music',
  effects: 'Game sounds',
};

function Toggle({ channel, compact }: { channel: SoundChannel; compact: boolean }) {
  const [muted, setChannelMuted] = useMuted(channel);
  const icons = ICONS[channel];

  return (
    <Pressable
      onPress={() => setChannelMuted(!muted)}
      hitSlop={6}
      style={[styles.button, compact && styles.buttonCompact, muted && styles.buttonOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: !muted }}
      accessibilityLabel={`${LABELS[channel]}, ${muted ? 'off' : 'on'}`}
    >
      <Ionicons
        name={muted ? icons.off : icons.on}
        size={compact ? 18 : 20}
        color={muted ? colors.text.muted : colors.gold.default}
      />
      {compact ? null : (
        <Txt variant="caption" color={muted ? colors.text.muted : colors.text.primary}>
          {LABELS[channel]}
        </Txt>
      )}
    </Pressable>
  );
}

/**
 * Both switches in a row.
 *
 * `compact` drops the labels down to bare icons, which is what a game screen
 * wants: it is competing with the reels for space, and a player who is already
 * in a game knows what a speaker icon does.
 */
export function SoundToggles({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Toggle channel="music" compact={compact} />
      <Toggle channel="effects" compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  rowCompact: { gap: spacing.xs },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.gold.default,
    backgroundColor: 'rgba(200,164,77,0.10)',
  },
  buttonCompact: {
    // A 36pt square. Below the 44pt ideal, but this floats over a game and the
    // cost of a mis-tap here is a sound, not money.
    width: 36,
    height: 36,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  buttonOff: {
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.overlay,
  },
});
