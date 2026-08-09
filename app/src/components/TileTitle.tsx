/**
 * A game's name, set the way a cabinet's name is set.
 *
 * This is drawn in SVG rather than laid out as text, for one reason: metal has
 * a gradient down it. A `<Text>` takes a single colour, and a single colour is
 * what made 23 titles look like 23 rows of a spreadsheet printed over the
 * artwork. Lettering that catches light at the top, deepens through the middle
 * and goes dark at the baseline is the difference between a caption and a sign.
 *
 * ## Three passes, not a filter
 *
 * The word is drawn three times: a very fat translucent stroke for the halo,
 * a thinner hard stroke for the rim, then the gradient fill. Strokes are
 * drawn under fills in that order, so what comes out is a lit edge, a hard
 * edge, and a graded face — without touching SVG filters, which are the part
 * of the spec that behaves differently on every renderer.
 *
 * ## Fitting
 *
 * SVG cannot tell you how wide a word will be until it has drawn it, and the
 * word has to fit the sign before it is drawn. So the width is estimated
 * (`displayWidth`), the viewBox is built at that size, and `preserveAspectRatio`
 * scales the whole thing to the box it is given. A generous estimate therefore
 * costs a couple of points of size and a mean one runs the name off the plaque,
 * which is why the estimate is deliberately generous.
 *
 * It also gives the lobby its variety for free: `Aurora` and `Pharaoh's Vault`
 * are fitted to the same plaque, so the short name comes out large and the long
 * one small, exactly as a sign painter would have set them.
 */

import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { HALO_OPACITY, displayFace, displayWidth, type TitleMetal } from '@juwa/ui';

/** Nominal glyph size in viewBox units. Only ratios matter; this is the unit. */
const EM = 100;
/**
 * Cap height of a heavy grotesque, as a fraction of its point size.
 *
 * The viewBox is built around the CAPS rather than around the em, because the
 * name is set in capitals and an em box is mostly descender space that no
 * glyph in it will ever use. Centring the em box put every title about a
 * twentieth of a tile too high — enough for the ones on shallow signs to sit on
 * the frame above them instead of on the sign.
 */
const CAP = 0.72;
/** Room above and below the caps for the halo and rim strokes. */
const PAD = 0.16;
const LETTER_SPACING = 0.06;

export function TileTitle({
  name,
  metal,
  style,
}: {
  name: string;
  metal: TitleMetal;
  style?: React.ComponentProps<typeof View>['style'];
}) {
  // Gradients are referenced by id, and two cards sharing an id means the
  // second one silently paints itself with the first one's metal.
  const gradient = `tile-metal-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const label = name.toUpperCase();
  const width = displayWidth(label, LETTER_SPACING) * EM;
  const height = (CAP + PAD * 2) * EM;
  // The strokes stick out past the glyphs; without room for them the halo is
  // sliced flat down both sides of the word.
  const bleed = PAD * EM;

  const common = {
    x: bleed + width / 2,
    y: (PAD + CAP) * EM,
    fontSize: EM,
    fontWeight: '900' as const,
    fontFamily: displayFace,
    letterSpacing: LETTER_SPACING * EM,
    textAnchor: 'middle' as const,
  };

  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width + bleed * 2} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={metal.top} />
            <Stop offset="0.46" stopColor={metal.mid} />
            <Stop offset="1" stopColor={metal.bottom} />
          </LinearGradient>
        </Defs>

        {/* Halo: lifts the word off whatever the artwork is doing behind it. */}
        <SvgText
          {...common}
          fill="none"
          stroke={metal.halo}
          strokeOpacity={HALO_OPACITY}
          strokeWidth={EM * 0.22}
          strokeLinejoin="round"
        >
          {label}
        </SvgText>
        {/* Rim: the hard edge that makes it lettering rather than a smudge. */}
        <SvgText
          {...common}
          fill="none"
          stroke={metal.rim}
          strokeWidth={EM * 0.075}
          strokeLinejoin="round"
        >
          {label}
        </SvgText>
        <SvgText {...common} fill={`url(#${gradient})`}>
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
  },
});
