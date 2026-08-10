/**
 * A password field you can look at.
 *
 * Every password box in this app used to be write-only: dots going in, no way
 * to check them. That is a small annoyance on a desktop keyboard and a real
 * failure on a phone, where autocorrect, a shifted thumb and a capital letter
 * you did not mean are all invisible until the server says "wrong password" —
 * and the error cannot tell you which character was wrong, because it does not
 * know either.
 *
 * It matters most in the two places this product actually uses passwords:
 * signing in on a phone at a counter, and a player typing a temporary password
 * their agent has just read out loud to them.
 *
 * ## Why the toggle is a button and not a "show password" checkbox
 *
 * The checkbox pattern reveals the field and leaves it revealed. A press-to-peek
 * button that the player has to deliberately turn back on is more typing for no
 * benefit, so this holds the state — but it is a labelled button with a real
 * touch target, announced to screen readers as "Show password"/"Hide password",
 * rather than a decorative eye somebody has to guess at.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';

export interface PasswordInputProps
  extends Omit<TextInputProps, 'secureTextEntry' | 'style' | 'accessibilityLabel'> {
  /** Announced to screen readers, and used to label the reveal button. */
  label: string;
}

export function PasswordInput({ label, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.wrap}>
      <TextInput
        {...rest}
        // Never autocapitalise or autocorrect a password: the first letter
        // arriving capitalised is the single most common cause of "but I typed
        // it right", and it is invisible behind the dots.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={!visible}
        style={styles.input}
        placeholderTextColor={colors.text.muted}
        accessibilityLabel={label}
      />
      <Pressable
        onPress={() => setVisible((on) => !on)}
        hitSlop={8}
        style={styles.toggle}
        accessibilityRole="button"
        accessibilityLabel={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        accessibilityState={{ selected: visible }}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={22}
          color={colors.text.muted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', justifyContent: 'center' },
  input: {
    minHeight: layout.minTouchTarget,
    backgroundColor: colors.surface.base,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    // Room for the eye, so a long password scrolls under the text rather than
    // beneath the button where it cannot be read.
    paddingRight: spacing.lg + 32,
    color: colors.text.primary,
    fontSize: typography.body.fontSize,
  },
  toggle: {
    position: 'absolute',
    right: spacing.sm,
    // A 44pt target, the accessibility floor, centred on the field.
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
