/**
 * Session-length simulator.
 *
 * Run with: npm run economy
 *
 * This is the tool that connects the game maths to the business. In a social
 * casino the RTP earns nothing directly — coins are not money. What the RTP
 * actually controls is *how long a balance lasts*, and that determines how often
 * a player hits zero and sees the store.
 *
 * Too generous and nobody ever needs to buy. Too harsh and players bust out in
 * ninety seconds, feel cheated, and uninstall. The sweet spot is a session that
 * lasts long enough to be fun and ends while the player still wants more.
 *
 * These numbers are how you tune that, instead of guessing.
 */

import { minor, type Minor } from '@juwa/money';
import { WELCOME_BONUS, dailyBonus } from '@juwa/economy';
import { RngStream } from '../rng.js';
import { classicSlots } from '../games/slots.js';

const engine = classicSlots();
const TRIALS = Number(process.env['ECON_TRIALS'] ?? 2_000);
/**
 * Give up rather than loop forever when a player runs hot.
 *
 * At 96.25% RTP a player loses only 3.75% of each stake on average, so a large
 * balance at a small bet survives astonishingly long — 100,000 GC at a 200 GC
 * bet runs for roughly 13,000 spins, about eighteen hours of play. Sessions that
 * long are not worth simulating precisely; they are "effectively unlimited", and
 * the cap reports them as such.
 */
const SPIN_CAP = 20_000;

interface SessionResult {
  spins: number;
  busted: boolean;
  peak: number;
}

/** Play until broke or until the cap, returning how long the balance survived. */
function playSession(startBalance: number, bet: number, seed: number): SessionResult {
  let balance = startBalance;
  let peak = startBalance;
  let spins = 0;

  while (balance >= bet && spins < SPIN_CAP) {
    const rng = new RngStream(`econ-${seed}`, 'sim', spins);
    const round = engine.init(minor(bet) as Minor, rng);
    balance -= bet;
    balance += round.settlement!.payout;
    spins++;
    if (balance > peak) peak = balance;
  }
  return { spins, busted: balance < bet, peak };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index]!;
}

function analyse(label: string, startBalance: number, bet: number) {
  const spins: number[] = [];
  let busted = 0;
  let peakSum = 0;

  for (let i = 0; i < TRIALS; i++) {
    const result = playSession(startBalance, bet, i);
    spins.push(result.spins);
    if (result.busted) busted++;
    peakSum += result.peak;
  }
  spins.sort((a, b) => a - b);

  // At roughly 5 seconds per spin including animation.
  const medianSpins = percentile(spins, 0.5);
  const minutes = (medianSpins * 5) / 60;

  console.log(`\n${label}`);
  console.log(`  bet ${bet.toLocaleString()} GC of a ${startBalance.toLocaleString()} GC balance` +
              `  (${Math.floor(startBalance / bet)} spins if it never paid)`);
  console.log(`  spins  p10 ${percentile(spins, 0.1).toString().padStart(5)}` +
              `   median ${medianSpins.toString().padStart(5)}` +
              `   p90 ${percentile(spins, 0.9).toString().padStart(6)}`);
  console.log(`  median session ~${minutes.toFixed(0)} min at 5s/spin`);
  console.log(`  busted out: ${((busted / TRIALS) * 100).toFixed(1)}%` +
              `   avg peak balance ${Math.round(peakSum / TRIALS).toLocaleString()} GC`);
}

console.log(`Simulating ${TRIALS.toLocaleString()} sessions per scenario` +
            ` at ${(engine.rtp * 100).toFixed(2)}% RTP\n` +
            '='.repeat(64));

console.log('\n--- A new player spending the welcome bonus ---');
analyse('Typical', WELCOME_BONUS, 2_000);
analyse('Aggressive', WELCOME_BONUS, 10_000);

console.log('\n--- A returning player on a day-1 streak ---');
analyse('Cautious', dailyBonus(1), 200);
analyse('Typical', dailyBonus(1), 1_000);

console.log('\n--- A committed player on a day-7 streak ---');
analyse('Typical', dailyBonus(7), 2_000);

console.log(`\n${'='.repeat(64)}`);
console.log(`
Reading this: the median session is the number that matters. If a returning
player's daily bonus is gone in under five minutes the game feels punishing and
they stop coming back; if it lasts an hour they never see the store. Adjust the
default bet in the UI first — it moves session length far more sharply than the
RTP does, and unlike the RTP it costs nothing to change.
`);
