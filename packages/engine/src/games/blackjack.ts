/**
 * Blackjack — 6-deck shoe, dealer stands on all 17s, blackjack pays 3:2.
 *
 * This is the reference implementation for a MULTI-STEP game. Slots resolve in
 * one call; blackjack is a state machine that hands control back to the player
 * between decisions. Everything the player must not see — the rest of the shoe
 * and the dealer's hole card — lives in `state.private`, which never leaves the
 * server.
 *
 * The 3:2 blackjack payout matters commercially. Many casinos moved to 6:5,
 * which raises the house edge from ~0.5% to ~2%. Players who count know, and
 * say so loudly. We pay 3:2.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Suit = 'S' | 'H' | 'D' | 'C';
export interface Card { rank: Rank; suit: Suit; }

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const DECKS = 6;
const MAX_HANDS = 4;

export interface Hand {
  cards: Card[];
  stake: Minor;
  /** Set once the hand can no longer act. */
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  outcome?: 'blackjack' | 'win' | 'push' | 'lose' | 'bust';
  payout?: Minor;
}

export interface BlackjackPublic {
  hands: Hand[];
  activeHand: number;
  /** Only the upcard until the dealer plays; then the full hand. */
  dealer: Card[];
  dealerRevealed: boolean;
}

export interface BlackjackPrivate {
  shoe: Card[];
  holeCard: Card | null;
}

function buildShoe(rng: RngStream): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < DECKS; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ rank, suit });
    }
  }
  return rng.shuffle(cards);
}

function cardValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J' || rank === '10') return 10;
  return Number(rank);
}

/** Best total <= 21 if possible, plus whether an ace is still counted as 11. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

function isBlackjack(hand: Hand): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && handValue(hand.cards).total === 21;
}

function draw(priv: BlackjackPrivate): Card {
  const card = priv.shoe.pop();
  if (!card) throw new Error('Shoe exhausted — reshuffle logic missing');
  return card;
}

function actionsFor(hand: Hand, handCount: number): string[] {
  if (hand.done) return [];
  const actions = ['hit', 'stand'];
  const value = handValue(hand.cards);
  if (hand.cards.length === 2 && !hand.doubled) {
    actions.push('double');
    const [a, b] = hand.cards;
    if (
      a && b &&
      cardValue(a.rank) === cardValue(b.rank) &&
      handCount < MAX_HANDS &&
      // No re-splitting aces — standard rule, and it keeps the edge where the
      // published RTP says it is.
      !(a.rank === 'A' && hand.fromSplit)
    ) {
      actions.push('split');
    }
  }
  if (value.total >= 21) return [];
  return actions;
}

export class BlackjackEngine
  implements GameEngine<BlackjackPublic, BlackjackPrivate, { decks: number }>
{
  readonly id = 'juwa-blackjack';
  readonly name = 'Blackjack';
  readonly category = 'table' as const;
  readonly limits: BetLimits;
  /** ~99.5% under basic strategy with these rules. */
  readonly rtp = 0.995;
  readonly config = { decks: DECKS };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(100), max: minor(100_000) };
  }

  init(stake: Minor, rng: RngStream): RoundState<BlackjackPublic, BlackjackPrivate> {
    assertWithinLimits(stake, this.limits);

    const priv: BlackjackPrivate = { shoe: buildShoe(rng), holeCard: null };
    const hand: Hand = {
      cards: [draw(priv), draw(priv)],
      stake,
      done: false,
      doubled: false,
      fromSplit: false,
    };
    const dealerUp = draw(priv);
    priv.holeCard = draw(priv);

    const state: RoundState<BlackjackPublic, BlackjackPrivate> = {
      status: 'awaiting-action',
      public: { hands: [hand], activeHand: 0, dealer: [dealerUp], dealerRevealed: false },
      private: priv,
      availableActions: actionsFor(hand, 1),
    };

    // A natural on either side ends the round before the player can act.
    const dealerNatural = handValue([dealerUp, priv.holeCard]).total === 21;
    if (isBlackjack(hand) || dealerNatural) {
      hand.done = true;
      return this.finish(state);
    }
    return state;
  }

  act(
    state: RoundState<BlackjackPublic, BlackjackPrivate>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<BlackjackPublic, BlackjackPrivate> {
    if (!state.availableActions.includes(action.type)) {
      throw new IllegalActionError(action.type, state.availableActions);
    }

    const priv = state.private;
    const pub = state.public;
    const hand = pub.hands[pub.activeHand];
    if (!hand) throw new IllegalActionError(action.type, state.availableActions);

    switch (action.type) {
      case 'hit': {
        hand.cards.push(draw(priv));
        if (handValue(hand.cards).total >= 21) hand.done = true;
        break;
      }
      case 'stand': {
        hand.done = true;
        break;
      }
      case 'double': {
        hand.stake = minor(hand.stake * 2);
        hand.doubled = true;
        hand.cards.push(draw(priv));
        hand.done = true;
        break;
      }
      case 'split': {
        const moved = hand.cards.pop()!;
        hand.fromSplit = true;
        hand.cards.push(draw(priv));
        const newHand: Hand = {
          cards: [moved, draw(priv)],
          stake: hand.stake,
          done: false,
          doubled: false,
          fromSplit: true,
        };
        pub.hands.splice(pub.activeHand + 1, 0, newHand);
        // Split aces receive exactly one card each and then stand.
        if (moved.rank === 'A') {
          hand.done = true;
          newHand.done = true;
        }
        break;
      }
      default:
        throw new IllegalActionError(action.type, state.availableActions);
    }

    return this.advance(state, rng);
  }

  /** Move to the next hand that can still act, or hand over to the dealer. */
  private advance(
    state: RoundState<BlackjackPublic, BlackjackPrivate>,
    _rng: RngStream,
  ): RoundState<BlackjackPublic, BlackjackPrivate> {
    const pub = state.public;
    while (pub.activeHand < pub.hands.length) {
      const hand = pub.hands[pub.activeHand]!;
      if (!hand.done && actionsFor(hand, pub.hands.length).length > 0) {
        state.availableActions = actionsFor(hand, pub.hands.length);
        return state;
      }
      hand.done = true;
      pub.activeHand++;
    }
    return this.finish(state);
  }

  /** Dealer plays out, then every hand is scored and the round settles. */
  private finish(
    state: RoundState<BlackjackPublic, BlackjackPrivate>,
  ): RoundState<BlackjackPublic, BlackjackPrivate> {
    const pub = state.public;
    const priv = state.private;

    if (priv.holeCard) {
      pub.dealer.push(priv.holeCard);
      priv.holeCard = null;
    }
    pub.dealerRevealed = true;

    const anyLive = pub.hands.some((h) => handValue(h.cards).total <= 21);
    if (anyLive) {
      // Dealer stands on all 17s, including soft 17.
      while (handValue(pub.dealer).total < 17) pub.dealer.push(draw(priv));
    }

    const dealerTotal = handValue(pub.dealer).total;
    const dealerBJ = pub.dealer.length === 2 && dealerTotal === 21;
    let totalStake = 0;
    let totalPayout = 0;

    for (const hand of pub.hands) {
      const total = handValue(hand.cards).total;
      const playerBJ = isBlackjack(hand);
      totalStake += hand.stake;

      if (playerBJ && dealerBJ) {
        hand.outcome = 'push';
        hand.payout = hand.stake;
      } else if (playerBJ) {
        hand.outcome = 'blackjack';
        hand.payout = mul(hand.stake, 2.5); // 3:2 plus the returned stake.
      } else if (total > 21) {
        hand.outcome = 'bust';
        hand.payout = minor(0);
      } else if (dealerBJ || (dealerTotal <= 21 && dealerTotal > total)) {
        hand.outcome = 'lose';
        hand.payout = minor(0);
      } else if (dealerTotal === total) {
        hand.outcome = 'push';
        hand.payout = hand.stake;
      } else {
        hand.outcome = 'win';
        hand.payout = mul(hand.stake, 2);
      }
      totalPayout += hand.payout;
    }

    state.status = 'settled';
    state.availableActions = [];
    state.settlement = {
      stake: minor(totalStake),
      payout: minor(totalPayout),
      multiplier: totalStake === 0 ? 0 : totalPayout / totalStake,
    };
    return state;
  }
}
