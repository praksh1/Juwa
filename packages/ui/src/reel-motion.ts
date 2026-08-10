/**
 * How a reel moves.
 *
 * A reel is a wheel with mass, and almost everything that makes a slot feel
 * mechanical rather than like a list being scrolled comes from respecting that:
 *
 *   - It cannot be at full speed on the first frame. Pressing the button
 *     engages a drive that has to overcome the wheel, and the wheel rocks
 *     BACKWARDS a fraction of a symbol before it goes anywhere.
 *   - It cannot stop dead. It overshoots its detent and rocks back into it.
 *   - It is blurred in proportion to how fast it is actually moving, which is
 *     not the same thing as how long it has been moving.
 *
 * These live here, away from the component, because they are a set of
 * interlocking numbers with a property that must hold between them and nothing
 * about a React component makes that property checkable. The property is
 * VELOCITY CONTINUITY: where the spin-up ramp hands over to the constant-speed
 * loop, the two must agree on how fast the reel is going. Out by any margin and
 * there is a step in the velocity, which in something that has been
 * accelerating like a wheel reads instantly as a dropped frame — a defect that
 * is obvious in motion and invisible in a screenshot, a code review or a
 * snapshot test.
 */

/**
 * Overshoot constant for the spin-up ramp — how deep the pull-back goes.
 *
 * The textbook 1.70158 dips about a tenth of the ramp distance, which at this
 * scale is a couple of pixels and reads as a rendering wobble rather than as
 * anything deliberate. 2.4 dips about a sixth, which on a 58-point symbol is
 * the quarter-symbol rock a real reel makes.
 */
export const RAMP_BACK = 2.4;
/**
 * The ramp's slope where it ends.
 *
 * Not a tuning knob — it is `d/du` of the ramp at u = 1, and it is what the
 * spin-up distance is divided by so the handover to the loop happens at
 * matching speed. `rampVelocityMatchesLoop` in the tests is the thing that
 * keeps this honest.
 */
export const RAMP_SLOPE = RAMP_BACK + 3;

/** Position along the spin-up, 0 to 1. Dips below zero early: the pull-back. */
export function rampPosition(u: number): number {
  return (RAMP_BACK + 1) * u * u * u - RAMP_BACK * u * u;
}

/** How fast the spin-up is moving at `u`. Zero at rest, `RAMP_SLOPE` at the end. */
export function rampSpeed(u: number): number {
  return 3 * (RAMP_BACK + 1) * u * u - 2 * RAMP_BACK * u;
}

/**
 * How far the ramp travels, given a top speed and how long it has to reach it.
 *
 * Derived rather than chosen. The ramp must end travelling at exactly the
 * loop's rate, its slope there is `RAMP_SLOPE`, so the distance is fixed the
 * moment the rate and the duration are.
 */
export function rampDistance(rate: number, seconds: number): number {
  return (rate * seconds) / RAMP_SLOPE;
}

/** Overshoot constant for the landing. The standard value; the reel settles. */
export const LAND_BACK = 1.70158;

/**
 * Fast out, hard decelerate, overshoot, settle — a reel hitting its detent.
 *
 * The overshoot is not decoration. A curve that approaches its target
 * asymptotically looks stopped well before it formally ends, so a stop sound
 * booked for the end arrives after the picture has already settled. This one is
 * still visibly moving until the last frame.
 */
export function landPosition(u: number): number {
  const p = u - 1;
  return 1 + (LAND_BACK + 1) * p * p * p + LAND_BACK * p * p;
}

/** How fast the landing is moving at `u`. Zero at both ends. */
export function landSpeed(u: number): number {
  const p = u - 1;
  return 3 * (LAND_BACK + 1) * p * p + 2 * LAND_BACK * p;
}

/** The landing's speed where it begins, so blur can be normalised against it. */
export const LAND_PEAK_SPEED = Math.abs(landSpeed(0));

/**
 * Blur, as a fraction of its maximum, from how fast the reel is moving.
 *
 * Taken from the DERIVATIVE of whichever curve the reel is on rather than from
 * elapsed time, and that is the whole point. A blur faded on elapsed time comes
 * off while the reel is still visibly rocking back into its detent, and comes
 * on before the reel has gone anywhere. Driving it from speed means it peaks
 * exactly when the reel is fastest and reaches zero exactly as it stops,
 * through the overshoot, for free.
 */
export function rampBlur(u: number): number {
  return Math.min(1, Math.abs(rampSpeed(u)) / RAMP_SLOPE);
}

export function landBlur(u: number): number {
  return Math.min(1, Math.abs(landSpeed(u)) / LAND_PEAK_SPEED);
}
