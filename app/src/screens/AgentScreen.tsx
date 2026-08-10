/**
 * The agent desk.
 *
 * An agent is a distributor: they hold an inventory of coins that an operator
 * gave them, and they hand it out to the players they recruited. This screen is
 * that job and nothing else — inventory at the top, the player list under it,
 * invitations, and a ledger.
 *
 * ## What is deliberately not on this screen
 *
 * There is no way to take coins BACK from a player, no cash-out, no transfer to
 * another agent, and no way to change which agent a player belongs to. None of
 * those are unbuilt features waiting for a later release: a balance that can
 * flow back out to a person is a balance that can be paid cash for, and that is
 * the line between a social casino and something that needs a gambling licence.
 * The server has no route for any of them either, so nothing here is enforced
 * by the absence of a button.
 *
 * ## Why the amount is typed rather than picked from chips
 *
 * Every other stake control in this app is a row of preset chips, because a
 * player picking a bet wants speed. An agent handing out coins is doing
 * accounting: the number is usually somebody else's, it is usually not round,
 * and it has to be re-read before it is sent. So it is a text field with a
 * confirmation step naming the player and the amount, and no default value.
 */

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Badge, Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { useAgentDesk } from '../api/useAgent';
import type { AgentPlayer } from '../api/client';
import { sounds } from '../sound';

const coins = (value: number) => Math.round(value).toLocaleString('en-US');

const STATUS_COLOUR = {
  active: colors.feedback.winBright,
  pending: colors.gold.default,
  suspended: colors.feedback.loss,
} as const;

export function AgentScreen() {
  const desk = useAgentDesk();
  const [selected, setSelected] = useState<AgentPlayer | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; good: boolean } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const parsed = Number(amount.replace(/[^0-9]/g, ''));
  const valid = Number.isInteger(parsed) && parsed > 0;
  /**
   * Refused before it is sent, so the agent finds out while they are still
   * looking at the number rather than after a round trip. The SERVER refuses it
   * too — `allocate_to_player` will not let an agent go below zero whatever
   * this screen believes — so this is a better error message, not the control.
   */
  const affordable = valid && parsed <= (desk.summary?.inventory ?? 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return desk.players;
    return desk.players.filter((player) => player.username.toLowerCase().includes(needle));
  }, [desk.players, search]);

  const send = async () => {
    if (!selected || !affordable || busy) return;
    setBusy(true);
    setNotice(null);
    const result = await desk.allocate(selected.playerId, parsed);
    setBusy(false);
    if (result.ok) {
      sounds.coinLock();
      setNotice({ text: `Sent ${coins(parsed)} GC to ${selected.username}.`, good: true });
      setSelected(null);
      setAmount('');
    } else {
      setNotice({ text: result.message ?? 'Could not send those coins', good: false });
    }
  };

  if (desk.loading) {
    return (
      <Screen>
        <View style={styles.centre}>
          <ActivityIndicator color={colors.gold.default} size="large" />
        </View>
      </Screen>
    );
  }

  if (desk.error || !desk.summary) {
    return (
      <Screen>
        <Card style={styles.centre}>
          <Txt variant="body" color={colors.feedback.loss}>
            {desk.error ?? 'Agent desk unavailable'}
          </Txt>
          <Button label="Try again" variant="secondary" onPress={() => void desk.refresh()} />
        </Card>
      </Screen>
    );
  }

  const { summary } = desk;

  return (
    <Screen>
      {/*
        Inventory, and it is the largest number on the screen on purpose. It is
        the one figure an agent checks before every conversation, and it is NOT
        their own balance — the coins they can play with are separate and live
        on the wallet tab, which is the distinction this header has to make
        unmissable.
      */}
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <Txt variant="caption" color={colors.text.muted}>
            INVENTORY TO DISTRIBUTE
          </Txt>
          <Badge label={summary.status.toUpperCase()} color={STATUS_COLOUR[summary.status]} />
        </View>
        <Txt variant="h1" color={colors.gold.light}>
          {coins(summary.inventory)}
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          Gold Coins · {summary.displayName} · {summary.playerCount}{' '}
          {summary.playerCount === 1 ? 'player' : 'players'}
        </Txt>
        <Txt variant="caption" color={colors.text.muted} style={styles.heroNote}>
          Separate from your own playable balance. Only an operator can add to this.
        </Txt>
      </Card>

      {summary.status !== 'active' ? (
        <Card style={styles.warn}>
          <Txt variant="bodySmall" color={colors.gold.light}>
            {summary.status === 'suspended'
              ? 'Your agent account is suspended. You cannot send coins or invite players until it is reinstated.'
              : 'Your agent account has not been activated yet. You can look around, but sending coins and inviting players is switched off.'}
          </Txt>
        </Card>
      ) : null}

      {notice ? (
        <Card style={notice.good ? styles.noticeGood : styles.noticeBad}>
          <Txt variant="bodySmall" color={notice.good ? colors.feedback.winBright : colors.feedback.loss}>
            {notice.text}
          </Txt>
        </Card>
      ) : null}

      {/* ------------------------------------------------------- allocation */}

      <View>
        <SectionHeader title="Send coins" />
        <Card style={styles.group}>
          {selected ? (
            <View style={styles.send}>
              <Txt variant="bodySmall" color={colors.text.muted}>
                To
              </Txt>
              <Txt variant="h3">{selected.username}</Txt>
              <Txt variant="caption" color={colors.text.muted}>
                They have {coins(selected.balance)} GC now
              </Txt>

              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="Amount in coins"
                placeholderTextColor={colors.text.muted}
                keyboardType="number-pad"
                inputMode="numeric"
                style={styles.input}
                accessibilityLabel="Amount in coins"
              />

              {valid && !affordable ? (
                <Txt variant="caption" color={colors.feedback.loss}>
                  That is more than your inventory holds ({coins(summary.inventory)} GC).
                </Txt>
              ) : null}

              <View style={styles.sendRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setSelected(null);
                    setAmount('');
                  }}
                  style={styles.flex}
                />
                <Button
                  // Names the player and the amount, so the confirming tap is
                  // on a sentence rather than on the word "Confirm".
                  label={
                    valid ? `Send ${coins(parsed)} to ${selected.username}` : 'Enter an amount'
                  }
                  onPress={() => void send()}
                  disabled={!affordable || summary.status !== 'active'}
                  loading={busy}
                  style={styles.flex2}
                />
              </View>
            </View>
          ) : (
            <View style={styles.send}>
              <Txt variant="bodySmall" color={colors.text.muted}>
                Pick a player below to send them coins. Coins you send cannot be taken back.
              </Txt>
            </View>
          )}
        </Card>
      </View>

      {/* ---------------------------------------------------------- players */}

      <View>
        <SectionHeader title={`Your players (${desk.players.length})`} />
        {desk.players.length > 6 ? (
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Find a player"
            placeholderTextColor={colors.text.muted}
            style={styles.input}
            accessibilityLabel="Find a player"
          />
        ) : null}
        <Card style={styles.group}>
          {visible.length === 0 ? (
            <View style={styles.empty}>
              <Txt variant="bodySmall" color={colors.text.muted}>
                {desk.players.length === 0
                  ? 'No players yet. Create an invite link below and send it to someone.'
                  : 'No player by that name.'}
              </Txt>
            </View>
          ) : (
            visible.map((player) => (
              <Pressable
                key={player.playerId}
                onPress={() => {
                  sounds.tap();
                  setSelected(player);
                  setAmount('');
                  setNotice(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Send coins to ${player.username}`}
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                  selected?.playerId === player.playerId && styles.rowSelected,
                ]}
              >
                <View style={styles.flex}>
                  <Txt variant="bodySmall">{player.username}</Txt>
                  <Txt variant="caption" color={colors.text.muted}>
                    {player.lastSeenAt
                      ? `Last seen ${new Date(player.lastSeenAt).toLocaleDateString()}`
                      : 'Not played yet'}
                  </Txt>
                </View>
                <Txt variant="bodySmall" color={colors.text.secondary}>
                  {coins(player.balance)}
                </Txt>
              </Pressable>
            ))
          )}
        </Card>
      </View>

      {/* -------------------------------------------------------- invites */}

      <View>
        <SectionHeader title="Invite players" />
        <Card style={styles.group}>
          <View style={styles.send}>
            <Txt variant="bodySmall" color={colors.text.muted}>
              An invite link signs someone up as your player. Each link works once and expires
              after seven days.
            </Txt>
            {invite ? (
              <View style={styles.token}>
                <Txt variant="caption" color={colors.text.muted}>
                  SEND THIS LINK — IT IS SHOWN ONCE
                </Txt>
                {/*
                  Selectable, and shown in full rather than truncated. This is
                  the only moment the raw token exists anywhere: the server
                  stores only its hash, so an agent who navigates away before
                  copying it has to issue a new one.
                */}
                <TextInput
                  value={inviteUrl(invite)}
                  editable={false}
                  multiline
                  style={[styles.input, styles.tokenText]}
                  accessibilityLabel="Invite link"
                />
              </View>
            ) : null}
            <Button
              label={invite ? 'Create another link' : 'Create invite link'}
              variant={invite ? 'secondary' : 'primary'}
              disabled={summary.status !== 'active'}
              onPress={async () => {
                sounds.tap();
                const result = await desk.createInvite();
                if (result.ok && result.token) {
                  setInvite(result.token);
                  setNotice(null);
                } else {
                  setNotice({ text: result.message ?? 'Could not create an invite', good: false });
                }
              }}
            />
          </View>

          {desk.invites.map((row) => (
            <View key={row.id} style={styles.row}>
              <View style={styles.flex}>
                <Txt variant="bodySmall">{row.label ?? 'Invite link'}</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  {row.redeemedAt
                    ? `Used by ${row.redeemedBy ?? 'a player'}`
                    : new Date(row.expiresAt) < new Date()
                      ? 'Expired'
                      : `Expires ${new Date(row.expiresAt).toLocaleDateString()}`}
                </Txt>
              </View>
              <Badge
                label={row.redeemedAt ? 'USED' : new Date(row.expiresAt) < new Date() ? 'EXPIRED' : 'OPEN'}
                color={row.redeemedAt ? colors.feedback.winBright : colors.text.muted}
              />
            </View>
          ))}
        </Card>
      </View>

      {/* --------------------------------------------------------- ledger */}

      <View>
        <SectionHeader title="History" />
        <Card style={styles.group}>
          {desk.transactions.length === 0 ? (
            <View style={styles.empty}>
              <Txt variant="bodySmall" color={colors.text.muted}>
                Nothing yet.
              </Txt>
            </View>
          ) : (
            desk.transactions.slice(0, 40).map((txn) => (
              <View key={txn.id} style={styles.row}>
                <View style={styles.flex}>
                  <Txt variant="bodySmall">
                    {txn.type === 'inventory'
                      ? 'Inventory added'
                      : `Sent to ${txn.counterparty ?? 'a player'}`}
                  </Txt>
                  <Txt variant="caption" color={colors.text.muted}>
                    {new Date(txn.at).toLocaleString()}
                  </Txt>
                </View>
                {/*
                  Signed, always. Read from the agent's own side of a
                  double-entry transaction, so money out is negative — a list
                  that showed both directions as positive would make the
                  inventory look like it had been credited twice.
                */}
                <Txt
                  variant="bodySmall"
                  color={txn.amount >= 0 ? colors.feedback.winBright : colors.text.secondary}
                >
                  {txn.amount >= 0 ? '+' : '−'}
                  {coins(Math.abs(txn.amount))}
                </Txt>
              </View>
            ))
          )}
        </Card>
        <Txt variant="caption" color={colors.text.muted} style={styles.footnote}>
          Every line here is a real transaction in the same ledger the games use. Nothing on this
          screen can be edited or deleted — a mistake is corrected by a further transaction.
        </Txt>
      </View>
    </Screen>
  );
}

/**
 * The link an agent actually sends.
 *
 * Built from where the app is being served rather than from a configured
 * constant, so an invite created on a staging build points at staging and one
 * created on production points at production. A hard-coded host is how an agent
 * ends up handing out links to a site their player cannot reach.
 */
function inviteUrl(token: string): string {
  const origin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'https://juwa.app';
  return `${origin}/?invite=${token}`;
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  hero: { gap: spacing.xs, paddingVertical: spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroNote: { marginTop: spacing.xs },
  warn: {
    borderColor: colors.gold.default,
    borderWidth: 1,
    backgroundColor: 'rgba(200,164,77,0.08)',
  },
  noticeGood: { backgroundColor: 'rgba(63,214,138,0.10)' },
  noticeBad: { backgroundColor: 'rgba(255,107,107,0.10)' },
  group: { padding: 0 },
  send: { padding: spacing.lg, gap: spacing.sm },
  sendRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  flex2: { flex: 2 },
  input: {
    backgroundColor: colors.surface.base,
    borderColor: colors.surface.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text.primary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  tokenText: { fontSize: 13, minHeight: 64 },
  token: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surface.border,
    // The accessibility floor for a tap target. A list of players is a list of
    // buttons that move money, and a mis-tap here sends coins to the wrong
    // person.
    minHeight: 60,
  },
  rowPressed: { backgroundColor: colors.surface.overlay },
  rowSelected: { backgroundColor: 'rgba(200,164,77,0.10)' },
  empty: { padding: spacing.lg },
  footnote: { marginTop: spacing.sm },
});
