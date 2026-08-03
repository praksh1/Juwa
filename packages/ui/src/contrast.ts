/**
 * WCAG contrast calculation.
 *
 * A dark, moody casino theme is exactly the kind of design where text quietly
 * becomes unreadable — grey-on-black looks elegant in a mockup and is invisible
 * on a phone in daylight. The test suite uses this to fail the build if any
 * text colour drops below the accessibility threshold against its background.
 *
 * WCAG AA requires 4.5:1 for body text and 3:1 for large text (18pt+ bold or
 * 24pt+ regular).
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Relative luminance per WCAG 2.1. */
export function luminance(color: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Contrast ratio between two colours, from 1:1 (identical) to 21:1 (max). */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(parseHex(foreground)), luminance(parseHex(background)));
  const darker = Math.min(luminance(parseHex(foreground)), luminance(parseHex(background)));
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsAA(foreground: string, background: string, largeText = false): boolean {
  return contrastRatio(foreground, background) >= (largeText ? 3 : 4.5);
}
