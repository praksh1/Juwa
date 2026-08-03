/**
 * RTP simulator.
 *
 * Run with: npm run rtp
 *
 * Simulates millions of rounds and reports actual return-to-player, hit
 * frequency, and volatility. This is how a game's advertised RTP is established
 * and how it is defended when a regulator or a player asks. Run it after any
 * change to a reel strip or paytable — those numbers ARE the business model.
 */

import { minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import { RouletteEngine } from '../games/roulette.js';
import { SlotsEngine } from '../games/slots.js';

const SPINS = Number(process.env['RTP_SPINS'] ?? 2_000_000);

function simulateSlots(spins: number) {
  const engine = new SlotsEngine();
  const stake = minor(2000); // $20.00
  let wagered = 0;
  let returned = 0;
  let hits = 0;
  let freeSpinTriggers = 0;
  let biggestWin = 0;
  let sumSquares = 0;

  for (let i = 0; i < spins; i++) {
    const rng = new RngStream('simulation-server-seed', 'simulation-client', i);
    const round = engine.init(stake, rng);
    const payout = round.settlement!.payout;
    wagered += stake;
    returned += payout;
    if (payout > 0) hits++;
    if (round.public.freeSpinsAwarded > 0) freeSpinTriggers++;
    if (payout > biggestWin) biggestWin = payout;
    const ratio = payout / stake;
    sumSquares += ratio * ratio;
  }

  const rtp = returned / wagered;
  const variance = sumSquares / spins - rtp * rtp;
  return {
    rtp,
    hitFrequency: hits / spins,
    freeSpinRate: freeSpinTriggers / spins,
    biggestWinX: biggestWin / stake,
    volatility: Math.sqrt(variance),
  };
}

function simulateRoulette(spins: number) {
  const engine = new RouletteEngine();
  const stake = minor(1000);
  let wagered = 0;
  let returned = 0;

  for (let i = 0; i < spins; i++) {
    const rng = new RngStream('simulation-server-seed', 'roulette', i);
    let state = engine.init(stake, rng);
    state = engine.act(state, { type: 'place-bets', bets: [
      { type: 'red', selection: [], amount: stake },
    ] }, rng);
    wagered += state.settlement!.stake;
    returned += state.settlement!.payout;
  }
  return { rtp: returned / wagered };
}

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

console.log(`Simulating ${SPINS.toLocaleString()} rounds per game...\n`);

const started = Date.now();
const slots = simulateSlots(SPINS);
console.log('Juwa Classic (5x3, 20 lines)');
console.log(`  RTP .................. ${pct(slots.rtp)}`);
console.log(`  Hit frequency ........ ${pct(slots.hitFrequency)}`);
console.log(`  Free spin trigger .... ${pct(slots.freeSpinRate)} (1 in ${Math.round(1 / slots.freeSpinRate)})`);
console.log(`  Biggest win .......... ${slots.biggestWinX.toFixed(1)}x`);
console.log(`  Volatility (sigma) ... ${slots.volatility.toFixed(2)}`);

const roulette = simulateRoulette(Math.min(SPINS, 500_000));
console.log('\nEuropean Roulette (flat red)');
console.log(`  RTP .................. ${pct(roulette.rtp)}  (theoretical ${pct(36 / 37)})`);

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
