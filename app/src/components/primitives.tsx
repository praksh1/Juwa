/**
 * Shared UI primitives.
 *
 * Everything here reads its values from `@juwa/ui` tokens. No component in this
 * app should ever contain a raw colour or a raw pixel value — if you find
 * yourself typing `#D4AF37` or `marginTop: 13`, the token is missing and should
 * be added rather than worked around.
 */

import React from 'react';
import { Animated, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import { useCompactLayout } from '../layout';

// ------------------------------------------------------------------- screen

/**
 * Standard scrollable screen.
 *
 * Every screen goes through this so the safe-area insets are handled in exactly
 * one place. Without the top inset, content slides under the notch and the
 * status bar; without the bottom inset it hides behind the iPhone home
 * indicator. Both look fine in a simulator and broken on a real phone, which is
 * why it belongs in a shared component rather than in each screen.
 */
export function Screen({
  children,
  contentStyle,
}: {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  // On a short screen the generous vertical rhythm is the difference between
  // a spin button on screen and one below the fold. The horizontal padding is
  // untouched — width is not what is scarce.
  const compact = useCompactLayout();
  return (
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.screenContent,
        compact && styles.screenContentCompact,
        {
          paddingTop: insets.top + (compact ? spacing.sm : spacing.lg),
          paddingBottom: insets.bottom + (compact ? spacing.lg : spacing['4xl']),
        },
        contentStyle,
      ]}
    >
      {children}
    </ScrollView>
  );
}

// --------------------------------------------------------------------- text

type TextVariant = keyof typeof typography;

export function Txt({
  variant = 'body',
  color = colors.text.primary,
  style,
  children,
  numberOfLines,
}: {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[typography[variant] as TextStyle, { color }, style]}
    >
      {children}
    </Text>
  );
}

// ------------------------------------------------------------------- button

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: colors.gold.default, fg: colors.text.inverse, border: 'transparent' },
    secondary: { bg: colors.surface.overlay, fg: colors.text.primary, border: colors.surface.border },
    ghost: { bg: 'transparent', fg: colors.gold.default, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          // Pressing shrinks the button very slightly. It is barely perceptible
          // and it is most of why a UI feels physical rather than flat.
          transform: [{ scale: pressed && !isDisabled ? 0.97 : 1 }],
          opacity: isDisabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text numberOfLines={1} style={[typography.h3 as TextStyle, { color: palette.fg }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------- card

/**
 * Renders an `Animated.View` rather than a `View`.
 *
 * Animated styles are ordinary styles to a plain View — it simply ignores the
 * animation and shows the initial value — so a card that needs to change
 * colour cannot do it through this component unless the underlying node is
 * animatable. Animated.View accepts static styles unchanged, so this costs
 * nothing for the cards that never animate.
 */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle> | Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
}) {
  return <Animated.View style={[styles.card, style]}>{children}</Animated.View>;
}

// ------------------------------------------------------------------- badge

export function Badge({ label, color = colors.gold.default }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[typography.caption as TextStyle, styles.badgeText]}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ----------------------------------------------------------- section header

export function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Txt variant="h3">{title}</Txt>
      {action ? (
        <Txt variant="bodySmall" color={colors.gold.default}>
          {action}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.base },
  screenContentCompact: { gap: spacing.sm },
  screenContent: {
    paddingHorizontal: layout.screenPadding,
    gap: spacing.xl,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  button: {
    minHeight: layout.minTouchTarget,
    // 12 rather than 16: two buttons side by side in a card leave little room,
    // and "Free Coins" was truncating to "Free Co…".
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface.raised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.surface.border,
    padding: spacing.lg,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: colors.text.inverse,
    letterSpacing: 0.6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
