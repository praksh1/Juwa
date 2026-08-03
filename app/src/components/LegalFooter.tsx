/**
 * The compliance footer. Required on every page, in legible text.
 *
 * "Legible" is doing real work in that sentence. The usual way this clause gets
 * neutered is by setting it at 9pt in a grey that fails contrast — which is
 * exactly the pattern a regulator reads as an attempt to hide it. So it uses
 * `text.secondary`, which the contrast tests hold at 4.5:1 or better against
 * every surface in the app, rather than `text.muted`.
 *
 * The wording is fixed. It is the sentence that makes this entertainment
 * software rather than gambling, and it should never be edited to fit a layout.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing, typography } from '@juwa/ui';
import { Txt } from './primitives';

export const LEGAL_TEXT =
  'Coins are play money for entertainment only. They have no cash value and ' +
  'cannot be exchanged, redeemed, or withdrawn. No purchase necessary to play. ' +
  '18+. Play responsibly.';

export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.footer, compact && styles.compact]}>
      <Txt variant="caption" color={colors.text.secondary} style={styles.text}>
        {LEGAL_TEXT}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  compact: { paddingVertical: spacing.md },
  text: {
    textAlign: 'center',
    textTransform: 'none',
    lineHeight: typography.caption.lineHeight + 4,
  },
});
