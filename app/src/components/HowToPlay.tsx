/**
 * "How to play" — a sheet a player can open and close, on the games that need
 * one.
 *
 * ## Why the instant games specifically
 *
 * A slot machine explains itself. Nobody has to be told that the reels spin,
 * that matching symbols pay, or that a bigger bet pays proportionally more —
 * the form is a hundred years old and the player has met it before. Crash,
 * Limbo, Dice, Plinko and Mines have none of that. "Cash out at 2.47×" is not
 * a phrase that means anything until somebody explains what is climbing and
 * what happens when it stops, and a player who does not know what the number
 * is doing cannot tell a good bet from a bad one.
 *
 * These five shipped with a single line of hint text under the board, which is
 * the right amount of explanation for a player who already knows the game and
 * no help at all to one who does not.
 *
 * ## Why a sheet rather than an intro card
 *
 * The slots use a full-screen intro with "don't show this again", because they
 * have a PAYTABLE — a table of numbers you need once, before you start, and
 * then rarely. These games have RULES, which you want in the middle of the
 * third round when you are wondering whether cashing out is allowed. So it is
 * always available, never in the way, and opens over the game rather than
 * replacing it.
 *
 * Everything in here is prose the player can act on. There is no room for a
 * paragraph about the RNG: what belongs on this sheet is what the buttons do
 * and what makes the number go up.
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { sounds, unlock } from '../sound';

export interface HowToPlayContent {
  /** One sentence: what this game IS. Read first, so it has to stand alone. */
  summary: string;
  /** The steps, in the order the player performs them. */
  steps: string[];
  /** What the controls on screen actually do, keyed by the label they carry. */
  controls?: { label: string; body: string }[];
  /** The honest odds line. Always present — see the note in the component. */
  edge: string;
}

/**
 * The button. Small, in the header row, next to the RTP.
 *
 * Deliberately carries the word "How to play" rather than a bare question mark:
 * an icon on its own is a thing you notice only if you were already looking for
 * help, and the players who most need this sheet are the ones who do not yet
 * know there is something to ask about.
 */
export function HowToPlayButton({
  title,
  content,
  accent,
}: {
  title: string;
  content: HowToPlayContent;
  accent: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => {
          unlock();
          sounds.tap();
          setOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`How to play ${title}`}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Txt variant="caption" color={colors.text.secondary} style={styles.buttonText}>
          ⓘ How to play
        </Txt>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        {/*
          The scrim closes the sheet. A modal whose only exit is a button at the
          bottom of a scroll is a modal players get stuck in — and this one is
          opened mid-round, so getting back must never take more than one tap
          anywhere.
        */}
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close">
          {/* Swallows taps on the sheet itself so they do not reach the scrim. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={[styles.grip, { backgroundColor: accent }]} />
            <Txt variant="h2" color={accent}>
              {title}
            </Txt>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
              <Txt variant="body" color={colors.text.primary}>
                {content.summary}
              </Txt>

              <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
                HOW TO PLAY
              </Txt>
              {content.steps.map((step, i) => (
                <View key={i} style={styles.step}>
                  <View style={[styles.stepNumber, { borderColor: accent }]}>
                    <Txt variant="caption" color={accent}>
                      {i + 1}
                    </Txt>
                  </View>
                  <Txt variant="bodySmall" color={colors.text.secondary} style={styles.stepBody}>
                    {step}
                  </Txt>
                </View>
              ))}

              {content.controls?.length ? (
                <>
                  <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
                    THE CONTROLS
                  </Txt>
                  {content.controls.map((control) => (
                    <View key={control.label} style={styles.control}>
                      <Txt variant="bodySmall" color={colors.text.primary}>
                        {control.label}
                      </Txt>
                      <Txt variant="caption" color={colors.text.secondary}>
                        {control.body}
                      </Txt>
                    </View>
                  ))}
                </>
              ) : null}

              {/*
                The odds, in the same sheet as the instructions rather than in a
                separate legal panel nobody opens. A player deciding how to bet
                is exactly the player who should be told what the house edge is,
                and burying it elsewhere would make this sheet a sales pitch.
              */}
              <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
                THE ODDS
              </Txt>
              <Txt variant="bodySmall" color={colors.text.secondary}>
                {content.edge}
              </Txt>
              <Txt variant="caption" color={colors.text.muted} style={styles.fair}>
                Every round is provably fair — the result is committed before you bet and can be
                checked afterwards from your profile.
              </Txt>
            </ScrollView>

            <Pressable
              onPress={() => {
                sounds.tap();
                setOpen(false);
              }}
              accessibilityRole="button"
              style={[styles.close, { backgroundColor: accent }]}
            >
              <Txt variant="h3" color={colors.surface.base}>
                Got it
              </Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.overlay,
  },
  buttonPressed: { backgroundColor: colors.surface.raised, borderColor: colors.gold.default },
  buttonText: { fontWeight: '700' },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    // Capped so the game stays visible behind it: this is a reference opened
    // mid-round, and covering the board would mean losing your place.
    maxHeight: '86%',
    backgroundColor: colors.surface.raised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.surface.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  grip: {
    width: 44,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.xs,
    opacity: 0.7,
  },
  scroll: { flexGrow: 0 },
  scrollBody: { gap: spacing.sm, paddingBottom: spacing.md },
  heading: { marginTop: spacing.sm, fontWeight: '800', letterSpacing: 0.6 },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBody: { flex: 1, minWidth: 0 },
  control: {
    gap: 1,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.overlay,
  },
  fair: { marginTop: spacing.xs, fontStyle: 'italic' },
  close: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
});
