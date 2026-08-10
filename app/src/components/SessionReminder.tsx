/**
 * "You have been playing for an hour."
 *
 * The one responsible-gaming control that lives in the app rather than the
 * database, and deliberately so: it refuses nothing. A reminder is a nudge, and
 * enforcing a nudge server-side would cost a request a minute to tell the
 * client something the client already knows.
 *
 * ## What counts as a session
 *
 * Time with the app in the foreground, accumulated across screens. Not wall
 * clock: a phone in a pocket for two hours has not been a two-hour session, and
 * a reminder waiting on the other side of that would fire the moment somebody
 * picks the phone back up — attaching the warning to the wrong moment and
 * teaching them to dismiss it.
 *
 * The clock resets when the reminder is acknowledged, so the second hour is
 * counted from the first warning rather than from the start.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { Button, Card, Txt } from './primitives';
import { createPlayApi } from '../api/client';

/** How often the accumulated time is checked. A minute is granular enough. */
const TICK_MS = 60_000;

export function SessionReminder() {
  const api = useRef(createPlayApi()).current;
  const [everyMinutes, setEveryMinutes] = useState<number | null>(null);
  const [showing, setShowing] = useState(false);
  /** Foreground milliseconds since the last reset. */
  const elapsed = useRef(0);
  const lastTick = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    api
      .getProfile()
      .then((profile) => alive && setEveryMinutes(profile.limits?.sessionReminderMinutes ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!everyMinutes) return undefined;

    // Backgrounding stops the clock rather than pausing a timer: a timer that
    // keeps running in a background tab counts time nobody spent playing.
    const onAppState = AppState.addEventListener('change', (state) => {
      if (state === 'active') lastTick.current = Date.now();
    });

    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick.current;
      lastTick.current = now;
      // A jump much larger than the tick means the tab was asleep. Count one
      // tick for it rather than the whole gap.
      elapsed.current += Math.min(delta, TICK_MS * 2);
      if (elapsed.current >= everyMinutes * 60_000) setShowing(true);
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      onAppState.remove();
    };
  }, [everyMinutes]);

  const acknowledge = useCallback(() => {
    elapsed.current = 0;
    lastTick.current = Date.now();
    setShowing(false);
  }, []);

  if (!showing) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={acknowledge}>
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <Txt variant="h3">You have been playing for {everyMinutes} minutes</Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            A good moment to stretch, or to stop. Coins are play money and they will still be here
            later.
          </Txt>
          <Button label="Keep playing" onPress={acknowledge} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 4, 14, 0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: { gap: spacing.md, padding: spacing.xl, maxWidth: 420 },
});
