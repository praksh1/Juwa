/**
 * What each instant game actually is, in words a player can act on.
 *
 * ## Written for somebody who has never seen the game
 *
 * That is the whole specification. These five have no physical ancestor — a
 * player has met a slot machine and a roulette table before opening this app,
 * and has almost certainly never met Limbo. So none of these entries assume
 * the reader knows what a multiplier is for, what "cash out" means, or why a
 * number climbing is tense.
 *
 * ## Every number here is quoted, not invented
 *
 * The edge lines say 1% because that is what `@juwa/economy` charges on these
 * five, and the payout figures are the ones the pickers on screen offer. If a
 * model changes, these strings are wrong and have to change with it — which is
 * the cost of writing them in prose, and worth paying, because a table of
 * coefficients would not have answered the question the player is asking.
 */

import type { HowToPlayContent } from '../../components/HowToPlay';

export const INSTANT_RULES: Record<string, HowToPlayContent> = {
  'juwa-crash': {
    summary:
      'A multiplier climbs from 1× and crashes at a random point. You win if you set your ' +
      'cash-out below where it crashes — and lose your stake if it crashes first.',
    steps: [
      'Choose your stake.',
      'Choose the multiplier you want to cash out at. 2× doubles your stake, 10× pays ten times it.',
      'Press Bet. The curve climbs from 1.00×.',
      'If it reaches your cash-out you are paid automatically. If it crashes before, the round is lost.',
    ],
    controls: [
      {
        label: 'CASH OUT AT',
        body: 'The multiplier you are aiming for. Lower is likelier to land; higher pays more.',
      },
      { label: 'Bet', body: 'Starts the round. Your cash-out is locked in before the curve moves.' },
    ],
    edge:
      'A 2× target lands a little under half the time; a 10× target a little under a tenth. ' +
      'Across every target the game returns 99% of what is staked over the long run, which is ' +
      'the 1% house edge — the same whichever multiplier you pick, so there is no target that ' +
      'is secretly better value than another.',
  },

  'juwa-limbo': {
    summary:
      'One number is drawn. You choose a target beforehand, and you win if the number drawn is ' +
      'at least as big as your target.',
    steps: [
      'Choose your stake.',
      'Choose your target multiplier — this is both what you need to hit and what it pays.',
      'Press Bet. A number is drawn.',
      'Draw at or above your target: you are paid your stake times the target. Below: the stake is lost.',
    ],
    controls: [
      {
        label: 'TARGET',
        body: 'A 2× target wins roughly half the time. A 100× target wins roughly one time in a hundred.',
      },
    ],
    edge:
      'The chance of winning is almost exactly 1 divided by your target, shaded by the house ' +
      "edge — so a 5× target comes in a bit less than one time in five. The game returns 99% of " +
      'what is staked over the long run at every target.',
  },

  'juwa-dice': {
    summary:
      'A number between 0.00 and 99.99 is rolled. You pick a line and whether the roll has to ' +
      'come in over it or under it.',
    steps: [
      'Choose your stake.',
      'Choose UNDER or OVER.',
      'Choose the line. UNDER 25 wins on any roll below 25; OVER 90 wins on any roll above 90.',
      'Press Bet. The payout shown next to the line is what you are paid if it comes in.',
    ],
    controls: [
      {
        label: 'UNDER / OVER',
        body: 'Which side of the line you need. The payout updates as soon as you change it.',
      },
      {
        label: 'The line',
        body: 'A narrower window wins less often and pays more. OVER 90 wins about one roll in ten and pays about 9.9×.',
      },
    ],
    edge:
      'The payout is always set so that the chance of winning times the payout comes to 99% of ' +
      'your stake — a 1% house edge, identical on every line and on both sides. Picking a rare ' +
      'window does not make the bet better or worse value, only swingier.',
  },

  'juwa-plinko': {
    summary:
      'A ball drops through a triangle of pegs, bouncing left or right at each one, and lands ' +
      'in one of the buckets along the bottom. The bucket it lands in decides what you are paid.',
    steps: [
      'Choose your stake.',
      'Choose how many rows of pegs — more rows means a longer fall and bigger extremes.',
      'Choose the risk. This changes the bucket values, not the odds of landing anywhere.',
      'Press Drop and watch it fall.',
    ],
    controls: [
      {
        label: 'Rows',
        body: 'The height of the board. Sixteen rows gives more buckets and a wider spread of payouts.',
      },
      {
        label: 'LOW / MEDIUM / HIGH',
        body: 'How extreme the buckets are. HIGH pays far more at the edges and far less in the middle.',
      },
    ],
    edge:
      'The ball is far likelier to end up near the middle than at an edge, which is why the ' +
      'middle buckets pay least — most drops land there. Every combination of rows and risk ' +
      'returns 99% of what is staked over the long run.',
  },

  'juwa-mines': {
    summary:
      'Twenty-five tiles, some of them mines. Turn over safe tiles one at a time — each one ' +
      'increases what you are holding. Cash out whenever you like, but hit a mine and you lose ' +
      'everything in the round.',
    steps: [
      'Choose your stake and how many mines to hide. More mines pay more per tile.',
      'Press Bet, then tap any tile to turn it over.',
      'Every safe tile raises your multiplier. The next one is always shown before you commit to it.',
      'Press Cash out to take what you are holding — or keep going.',
    ],
    controls: [
      {
        label: 'MINES',
        body: 'How many of the 25 tiles are mines. Three mines is a gentle game; twenty-four is one pick for a large payout.',
      },
      {
        label: 'Cash out',
        body: 'Ends the round and pays your current multiplier. Available from your first safe tile onward.',
      },
    ],
    edge:
      'Each pick is genuinely random among the tiles you have not turned over, and the ' +
      'multiplier rises to match the risk you just took. The game returns 99% of what is staked ' +
      'over the long run at every mine count. There is no pattern to the mine positions and no ' +
      'tile that is safer than another.',
  },
};
