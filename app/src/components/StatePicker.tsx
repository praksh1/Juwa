/**
 * State of residence.
 *
 * Restricted states are ABSENT from this list rather than present-and-disabled.
 * A greyed-out "Washington" tells someone in Washington exactly which lie to
 * tell; an absent one gives them nothing to work with, and the honest majority
 * never notice either way. The server refuses a restricted code regardless of
 * what this component offered.
 *
 * Rendered as a native `<select>` on the web rather than a custom dropdown. A
 * fifty-item list is miserable in a hand-rolled popover on a phone, and the
 * platform control is already keyboard-accessible, screen-reader-labelled, and
 * familiar. React Native has no `Picker` in core, and pulling a package in for
 * one field is not worth the dependency.
 */

import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import type { Jurisdiction } from '@juwa/economy';
import { Txt } from './primitives';

export function StatePicker({
  states,
  value,
  onChange,
}: {
  states: Jurisdiction[];
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Txt variant="caption" color={colors.text.muted}>
        STATE OF RESIDENCE
      </Txt>

      {Platform.OS === 'web' ? (
        // `createElement` because react-native-web has no <select> primitive.
        // The style object is plain CSS here, not a StyleSheet entry.
        React.createElement('select', {
          value,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
          'aria-label': 'State of residence',
          style: {
            minHeight: layout.minTouchTarget,
            width: '100%',
            backgroundColor: colors.surface.base,
            border: `1px solid ${colors.surface.border}`,
            borderRadius: radius.md,
            padding: `0 ${spacing.md}px`,
            color: value ? colors.text.primary : colors.text.muted,
            fontSize: typography.body.fontSize,
            fontFamily: 'inherit',
            appearance: 'auto',
          },
        }, [
          React.createElement('option', { key: '', value: '' }, 'Choose your state'),
          ...states.map((state) =>
            React.createElement('option', { key: state.code, value: state.code }, state.name),
          ),
        ])
      ) : (
        <ScrollView style={styles.nativeList} nestedScrollEnabled>
          {states.map((state) => (
            <Pressable
              key={state.code}
              onPress={() => onChange(state.code)}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === state.code }}
              style={[styles.row, value === state.code && styles.rowActive]}
            >
              <Txt
                variant="bodySmall"
                color={value === state.code ? colors.text.inverse : colors.text.primary}
              >
                {state.name}
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  nativeList: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface.base,
  },
  row: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: layout.minTouchTarget },
  rowActive: { backgroundColor: colors.neon.cyan },
});
