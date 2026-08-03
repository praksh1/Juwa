import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, layout, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { createPlayApi } from '../api/client';

/**
 * Confirms a purchase after Stripe sends the browser back.
 *
 * Mounted at the top of the authenticated app, NOT on the store screen. Stripe
 * returns the player to the site root, which renders the lobby — so a watcher
 * that lived on the store would simply never run, and a player who had just
 * paid would see nothing at all.
 *
 * This polls our own server. The redirect itself proves nothing: anyone can
 * visit the success URL. What it is really waiting for is the signed webhook,
 * which is the only thing that grants coins.
 */
export function PurchaseWatcher({ onGranted }: { onGranted: () => void }) {
  const api = React.useRef(createPlayApi()).current;
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'pending' | 'good' | 'bad'>('pending');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const purchaseId = new URL(window.location.href).searchParams.get('purchase');
    if (!purchaseId) return;

    // Strip the query immediately so a refresh does not replay this.
    window.history.replaceState({}, '', window.location.pathname);

    let cancelled = false;
    let attempts = 0;
    setMessage('Confirming your payment…');
    setTone('pending');

    const poll = async () => {
      if (cancelled) return;
      try {
        const purchase = await api.getPurchase(purchaseId);
        if (purchase.status === 'verified') {
          setTone('good');
          setMessage(`Added ${purchase.coins.toLocaleString('en-US')} GC. Enjoy!`);
          onGranted();
          return;
        }
        if (purchase.status === 'failed') {
          setTone('bad');
          setMessage('That payment did not go through. You have not been charged.');
          return;
        }
      } catch {
        // A transient read failure is not a failed payment — keep waiting.
      }
      // Webhooks usually land within a second or two, but not always.
      if (++attempts < 12) {
        setTimeout(poll, 2000);
      } else {
        setTone('pending');
        setMessage('Payment received — your coins will appear shortly.');
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [api, onGranted]);

  if (!message) return null;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <Pressable
        onPress={() => setMessage(null)}
        accessibilityRole="button"
        accessibilityLabel={`${message}. Tap to dismiss.`}
        style={[
          styles.banner,
          tone === 'good' && styles.good,
          tone === 'bad' && styles.bad,
        ]}
      >
        <Txt variant="bodySmall">{message}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    // Above the tab bar rather than the top of the screen: a top banner lands
    // squarely on the lobby's balance pill, hiding the very number the player
    // just paid to change.
    bottom: layout.tabBarHeight + spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 100,
    alignItems: 'center',
  },
  banner: {
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    maxWidth: 480,
  },
  good: { borderColor: colors.feedback.win },
  bad: { borderColor: colors.feedback.error },
});
