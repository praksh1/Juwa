/**
 * The rules screen and the paytable.
 *
 * Two views of the same information, shown at two different moments, because a
 * player needs it at two different moments:
 *
 *   `RulesIntro` — a full-screen card on the way into a game, once. What the
 *   symbols pay, what triggers the bonus, and a PLAY button. It carries a
 *   "don't show this again" box, which is the whole reason it is tolerable:
 *   without it, the third visit is an obstacle rather than an explanation.
 *
 *   `PaytableSheet` — the same table, reachable from a small button beside the
 *   machine, for the player who dismissed the intro six weeks ago and now
 *   wants to know what a bell is worth.
 *
 * ## The unit trap
 *
 * Line pays are quoted PER LINE and scatter pays against the TOTAL bet. That
 * is how slots work everywhere, and it is also the easiest thing in this file
 * to get wrong: quoting line pays against the total bet understates every row
 * by the payline count — twenty-fold on the flagship — and a paytable that
 * disagrees with what lands in the balance is worse than no paytable at all.
 *
 * So both units are labelled on screen, in words, next to the numbers. See the
 * note on `SlotModelInfo`.
 */

import React, { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { scatterTrigger, type SlotGame, type SlotModelInfo } from '../api/games';
import { SlotSymbol } from './SlotSymbol';
import { Txt } from './primitives';

const SEEN_PREFIX = 'juwa.rules-seen.';

/**
 * Whether the intro has been dismissed for good, per game.
 *
 * Per game rather than globally: the models differ, so "I have read the rules"
 * for a three-reel classic says nothing about a twenty-line game with a bonus
 * round. Keyed by MODEL would be cleverer and would surprise a player who
 * opened a new theme and saw nothing.
 *
 * Storage failures are swallowed and treated as "not seen". Private browsing
 * throws on write in some browsers, and a rules card is not worth an error.
 */
export function rulesDismissed(gameId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_PREFIX + gameId) === '1';
  } catch {
    return false;
  }
}

export function dismissRules(gameId: string): void {
  try {
    window.localStorage.setItem(SEEN_PREFIX + gameId, '1');
  } catch {
    // No persistence available. The intro shows again next time, which is the
    // safe direction to fail in.
  }
}

/** Highest-paying first. A paytable in engine order is a paytable nobody reads. */
function byValue(model: SlotModelInfo) {
  return [...model.symbols].sort((a, b) => (b.pays['5'] || b.pays['3']) - (a.pays['5'] || a.pays['3']));
}

// ---------------------------------------------------------------- paytable

function PaytableRows({ model, family }: { model: SlotModelInfo; family?: string }) {
  const symbols = byValue(model);
  // A three-reel classic pays only for three of a kind, so the 4 and 5 columns
  // would be a block of zeroes. Drop them rather than print them.
  const showFour = symbols.some((s) => s.pays['4'] > 0);
  const showFive = symbols.some((s) => s.pays['5'] > 0);
  const trigger = scatterTrigger(model);

  return (
    <View style={styles.table}>
      <View style={styles.headRow}>
        <View style={styles.symbolCell} />
        <Txt variant="caption" color={colors.text.muted} style={styles.payCell}>
          3
        </Txt>
        {showFour ? (
          <Txt variant="caption" color={colors.text.muted} style={styles.payCell}>
            4
          </Txt>
        ) : null}
        {showFive ? (
          <Txt variant="caption" color={colors.text.muted} style={styles.payCell}>
            5
          </Txt>
        ) : null}
      </View>

      {symbols.map((symbol) => (
        <View key={symbol.id} style={styles.row}>
          <View style={styles.symbolCell}>
            <SlotSymbol name={symbol.id} size={30} {...(family ? { family } : {})} />
          </View>
          <Txt variant="caption" color={colors.gold.default} style={styles.payCell}>
            {symbol.pays['3'] || '—'}
          </Txt>
          {showFour ? (
            <Txt variant="caption" color={colors.gold.default} style={styles.payCell}>
              {symbol.pays['4'] || '—'}
            </Txt>
          ) : null}
          {showFive ? (
            <Txt variant="caption" color={colors.gold.default} style={styles.payCell}>
              {symbol.pays['5'] || '—'}
            </Txt>
          ) : null}
        </View>
      ))}

      <Txt variant="caption" color={colors.text.muted} style={styles.note}>
        Pays are per line, on {model.lines} line{model.lines === 1 ? '' : 's'}, left to right from
        reel one. WILD stands in for any symbol except SCATTER.
      </Txt>
      {trigger ? (
        <Txt variant="caption" color={colors.text.muted} style={styles.note}>
          {trigger.count} or more SCATTER anywhere awards {trigger.spins} free spins, with every win
          multiplied by {model.freeSpinMultiplier}. Scatters pay on the total bet.
        </Txt>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------- intro

export function RulesIntro({
  game,
  model,
  onPlay,
}: {
  game: SlotGame;
  model: SlotModelInfo;
  onPlay: () => void;
}) {
  const [dontShow, setDontShow] = useState(false);
  const play = useCallback(() => {
    if (dontShow) dismissRules(game.id);
    onPlay();
  }, [dontShow, game.id, onPlay]);
  const trigger = scatterTrigger(model);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={play}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { borderColor: game.theme.accent }]}>
          <ScrollView contentContainerStyle={styles.cardBody}>
            <Txt variant="h2" color={game.theme.accent}>
              {game.name}
            </Txt>
            <Txt variant="caption" color={colors.text.muted}>
              {game.reels}×{game.rows} · {model.lines} line{model.lines === 1 ? '' : 's'} · RTP{' '}
              {(game.rtp * 100).toFixed(2)}%
            </Txt>

            {trigger ? (
              <Txt variant="bodySmall" color={colors.text.secondary} style={styles.headline}>
                Land {trigger.count} SCATTER for {trigger.spins} free spins at{' '}
                {model.freeSpinMultiplier}× wins.
              </Txt>
            ) : null}

            <PaytableRows model={model} {...(game.art ? { family: game.art } : {})} />
          </ScrollView>

          {/*
            Outside the ScrollView, deliberately.
            A full paytable is taller than a phone, so with the action inside
            the scroll area the PLAY button sat below the fold and the card
            looked like a wall of numbers with no way past it. The table
            scrolls; the way out does not move.
          */}
          <View style={styles.footer}>
            <Pressable
              onPress={() => setDontShow((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontShow }}
              style={styles.checkRow}
              hitSlop={8}
            >
              <View style={[styles.checkbox, dontShow && styles.checkboxOn]}>
                {dontShow ? (
                  <Txt variant="caption" color={colors.surface.base}>
                    ✓
                  </Txt>
                ) : null}
              </View>
              <Txt variant="caption" color={colors.text.muted}>
                Don't show this again
              </Txt>
            </Pressable>

            <Pressable
              onPress={play}
              accessibilityRole="button"
              style={[styles.playButton, { backgroundColor: game.theme.accent }]}
            >
              <Txt variant="h3" color={colors.surface.base}>
                PLAY
              </Txt>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ------------------------------------------------------------------- sheet

/** The small button that lives beside the machine, and the sheet it opens. */
export function PaytableButton({ game, model }: { game: SlotGame; model: SlotModelInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Paytable"
        style={styles.infoButton}
        hitSlop={10}
      >
        <Txt variant="caption" color={colors.text.secondary}>
          ⓘ Paytable
        </Txt>
      </Pressable>

      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Swallows taps so pressing the sheet itself does not close it. */}
          <Pressable style={[styles.card, { borderColor: game.theme.accent }]} onPress={() => {}}>
            <ScrollView contentContainerStyle={styles.cardBody}>
              <Txt variant="h3" color={game.theme.accent}>
                {game.name}
              </Txt>
              <PaytableRows model={model} {...(game.art ? { family: game.art } : {})} />
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                style={[styles.playButton, { backgroundColor: colors.surface.raised }]}
              >
                <Txt variant="bodySmall" color={colors.text.primary}>
                  Close
                </Txt>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 4, 14, 0.86)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    maxHeight: '86%',
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface.raised,
    overflow: 'hidden',
  },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
    backgroundColor: colors.surface.raised,
  },
  headline: { marginTop: spacing.xs },
  table: { marginTop: spacing.sm, gap: 2 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  symbolCell: { width: 44, alignItems: 'center' },
  payCell: { flex: 1, textAlign: 'right', paddingRight: spacing.sm },
  note: { marginTop: spacing.xs, lineHeight: 16 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    // A 44px row: the checkbox itself is 20px, which is far below the minimum
    // reliable touch target on a phone.
    minHeight: 44,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.text.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  playButton: {
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  infoButton: {
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
