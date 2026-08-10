/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/generate-game-catalogue.mjs from the engine's
 * SLOT_CATALOGUE. Re-run it after changing the catalogue; the build checks
 * that this file is current.
 *
 * The app cannot import @juwa/engine (see api/games.ts), so this is the
 * lobby's copy of what the server can actually deal.
 */

import type { SlotGame, SlotModelInfo } from './games';

export const SLOT_GAMES: SlotGame[] = [
  { id: 'juwa-classic-slots', name: 'Juwa Classic', category: 'slots', rtp: 0.9608, volatility: 'low', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#7C3AED', secondary: '#C026D3', accent: '#FFC53D' }, model: 'classic-20', tag: 'hot', art: 'fruit' },
  { id: 'slot-emerald-nights', name: 'Emerald Nights', category: 'slots', rtp: 0.9608, volatility: 'low', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#065F46', secondary: '#10B981', accent: '#A7F3D0' }, model: 'classic-20', art: 'jungle' },
  { id: 'slot-royal-flush', name: 'Royal Fortune', category: 'slots', rtp: 0.9608, volatility: 'low', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#7F1D1D', secondary: '#DC2626', accent: '#FCA5A5' }, model: 'classic-20', art: 'myth' },
  { id: 'slot-ocean-drift', name: 'Ocean Drift', category: 'slots', rtp: 0.9568, volatility: 'low', reels: 5, rows: [3, 4, 5, 4, 3], lines: 720, pays: 'ways', minBet: 10, maxBet: 10000, theme: { primary: '#0C4A6E', secondary: '#0EA5E9', accent: '#BAE6FD' }, model: 'ways-diamond', art: 'pirate' },
  { id: 'slot-sunset-strip', name: 'Sunset Strip', category: 'slots', rtp: 0.9608, volatility: 'low', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#9A3412', secondary: '#FB923C', accent: '#FED7AA' }, model: 'classic-20', art: 'wildwest' },
  { id: 'slot-midnight-gold', name: 'Midnight Gold', category: 'slots', rtp: 0.95, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 10, pays: 'lines', feature: 'expanding-wild', minBet: 20, maxBet: 50000, theme: { primary: '#1C1917', secondary: '#78716C', accent: '#FFC53D' }, model: 'lines-10', art: 'wildwest' },
  { id: 'slot-neon-alley', name: 'Neon Alley', category: 'slots', rtp: 0.95, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 10, pays: 'lines', feature: 'expanding-wild', minBet: 20, maxBet: 50000, theme: { primary: '#4C1D95', secondary: '#2FE3D6', accent: '#FF3D8A' }, model: 'lines-10', tag: 'new', art: 'orb' },
  { id: 'slot-desert-mirage', name: 'Desert Mirage', category: 'slots', rtp: 0.95, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 10, pays: 'lines', feature: 'expanding-wild', minBet: 20, maxBet: 50000, theme: { primary: '#78350F', secondary: '#D97706', accent: '#FDE68A' }, model: 'lines-10', art: 'egypt' },
  { id: 'slot-frost-peak', name: 'Frost Peak', category: 'slots', rtp: 0.95, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 10, pays: 'lines', feature: 'expanding-wild', minBet: 10, maxBet: 10000, theme: { primary: '#1E3A8A', secondary: '#60A5FA', accent: '#DBEAFE' }, model: 'lines-10', art: 'orb' },
  { id: 'slot-jade-temple', name: 'Jade Temple', category: 'slots', rtp: 0.9568, volatility: 'low', reels: 5, rows: [3, 4, 5, 4, 3], lines: 720, pays: 'ways', minBet: 20, maxBet: 50000, theme: { primary: '#134E4A', secondary: '#14B8A6', accent: '#99F6E4' }, model: 'ways-diamond', art: 'asian' },
  { id: 'slot-carnival-row', name: 'Carnival Row', category: 'slots', rtp: 0.9646, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 25, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#831843', secondary: '#EC4899', accent: '#FBCFE8' }, model: 'lines-25', art: 'orb' },
  { id: 'slot-jungle-run', name: 'Jungle Run', category: 'slots', rtp: 0.9646, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 25, pays: 'lines', minBet: 20, maxBet: 50000, theme: { primary: '#14532D', secondary: '#65A30D', accent: '#D9F99D' }, model: 'lines-25', art: 'jungle' },
  { id: 'slot-city-lights', name: 'City Lights', category: 'slots', rtp: 0.9408, volatility: 'high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', cascades: true, minBet: 20, maxBet: 50000, theme: { primary: '#0F172A', secondary: '#38BDF8', accent: '#F1F5F9' }, model: 'tumble-20', art: 'orb' },
  { id: 'slot-spice-market', name: 'Spice Market', category: 'slots', rtp: 0.9646, volatility: 'medium', reels: 5, rows: [3, 3, 3, 3, 3], lines: 25, pays: 'lines', minBet: 10, maxBet: 10000, theme: { primary: '#7C2D12', secondary: '#EA580C', accent: '#FFEDD5' }, model: 'lines-25', art: 'asian' },
  { id: 'slot-aurora-borealis', name: 'Aurora', category: 'slots', rtp: 0.9568, volatility: 'low', reels: 5, rows: [3, 4, 5, 4, 3], lines: 720, pays: 'ways', minBet: 20, maxBet: 50000, theme: { primary: '#312E81', secondary: '#818CF8', accent: '#C7D2FE' }, model: 'ways-diamond', art: 'orb' },
  { id: 'slot-dragons-hoard', name: 'Dragon\'s Hoard', category: 'slots', rtp: 0.95, volatility: 'very-high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', feature: 'hold-spin', minBet: 100, maxBet: 200000, theme: { primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' }, model: 'high-vol', tag: 'mega', art: 'asian' },
  { id: 'slot-vault-breaker', name: 'Vault Breaker', category: 'slots', rtp: 0.95, volatility: 'very-high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', feature: 'hold-spin', minBet: 100, maxBet: 200000, theme: { primary: '#18181B', secondary: '#52525B', accent: '#2FE3D6' }, model: 'high-vol', art: 'pirate' },
  { id: 'slot-supernova', name: 'Supernova', category: 'slots', rtp: 0.9408, volatility: 'high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', cascades: true, minBet: 20, maxBet: 50000, theme: { primary: '#1E1B4B', secondary: '#7C3AED', accent: '#F0ABFC' }, model: 'tumble-20', tag: 'new', art: 'orb' },
  { id: 'slot-pharaohs-vault', name: 'Pharaoh\'s Vault', category: 'slots', rtp: 0.95, volatility: 'very-high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', feature: 'hold-spin', minBet: 100, maxBet: 200000, theme: { primary: '#422006', secondary: '#CA8A04', accent: '#FEF08A' }, model: 'high-vol', art: 'egypt' },
  { id: 'slot-storm-chaser', name: 'Storm Chaser', category: 'slots', rtp: 0.9408, volatility: 'high', reels: 5, rows: [3, 3, 3, 3, 3], lines: 20, pays: 'lines', cascades: true, minBet: 20, maxBet: 50000, theme: { primary: '#164E63', secondary: '#06B6D4', accent: '#CFFAFE' }, model: 'tumble-20', art: 'myth' },
  { id: 'slot-lucky-sevens', name: 'Lucky Sevens', category: 'slots', rtp: 0.943, volatility: 'high', reels: 3, rows: [1, 1, 1], lines: 1, pays: 'lines', minBet: 10, maxBet: 10000, theme: { primary: '#7F1D1D', secondary: '#EF4444', accent: '#FFC53D' }, model: 'classic-3', art: 'fruit' },
  { id: 'slot-triple-bar', name: 'Triple Bar', category: 'slots', rtp: 0.9481, volatility: 'medium', reels: 3, rows: [3, 3, 3], lines: 5, pays: 'lines', feature: 'wheel', minBet: 10, maxBet: 10000, theme: { primary: '#1C1917', secondary: '#57534E', accent: '#E6CE8C' }, model: 'classic-3x3', art: 'fruit' },
  { id: 'slot-fruit-stand', name: 'Fruit Stand', category: 'slots', rtp: 0.9481, volatility: 'medium', reels: 3, rows: [3, 3, 3], lines: 5, pays: 'lines', feature: 'wheel', minBet: 10, maxBet: 10000, theme: { primary: '#166534', secondary: '#22C55E', accent: '#FEF08A' }, model: 'classic-3x3', art: 'fruit' },
];

/** Paytables by model id. See the note in the generator about the two units. */
export const SLOT_MODEL_INFO: Record<string, SlotModelInfo> = {
  "classic-20": {
    "id": "classic-20",
    "lines": 20,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 65,
          "4": 400,
          "5": 2500
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 50,
          "4": 250,
          "5": 1250
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 40,
          "4": 160,
          "5": 650
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 25,
          "4": 100,
          "5": 400
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 15,
          "4": 50,
          "5": 200
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 9,
          "4": 30,
          "5": 100
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 8,
          "4": 20,
          "5": 60
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 5,
          "4": 15,
          "5": 50
        }
      }
    ],
    "scatterPays": {
      "3": 3,
      "4": 15,
      "5": 75
    },
    "freeSpinsAwarded": {
      "3": 8,
      "4": 12,
      "5": 20
    },
    "freeSpinMultiplier": 3
  },
  "lines-10": {
    "id": "lines-10",
    "lines": 10,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 28.62,
          "4": 131.65,
          "5": 592.43
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 21.47,
          "4": 98.74,
          "5": 444.09
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 16.7,
          "4": 76.8,
          "5": 345.83
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 10.49,
          "4": 48.18,
          "5": 217.04
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 6.68,
          "4": 30.53,
          "5": 138.33
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 4.29,
          "4": 19.56,
          "5": 88.72
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 3.34,
          "4": 15.26,
          "5": 69.16
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 2.38,
          "4": 10.97,
          "5": 49.13
        }
      }
    ],
    "scatterPays": {
      "3": 1.91,
      "4": 8.59,
      "5": 42.93
    },
    "freeSpinsAwarded": {
      "3": 10,
      "4": 15,
      "5": 25
    },
    "freeSpinMultiplier": 3,
    "feature": {
      "kind": "expanding-wild",
      "reels": [
        2
      ]
    }
  },
  "lines-25": {
    "id": "lines-25",
    "lines": 25,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 54.29,
          "4": 228.01,
          "5": 1026.04
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 40.72,
          "4": 171.01,
          "5": 769.98
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 31.67,
          "4": 133.01,
          "5": 598.98
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 19.91,
          "4": 83.24,
          "5": 376.4
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 12.67,
          "4": 53.38,
          "5": 239.77
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 8.14,
          "4": 34.38,
          "5": 153.82
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 6.33,
          "4": 26.24,
          "5": 119.43
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 4.52,
          "4": 19,
          "5": 85.96
        }
      }
    ],
    "scatterPays": {
      "3": 2.71,
      "4": 12.67,
      "5": 63.34
    },
    "freeSpinsAwarded": {
      "3": 8,
      "4": 14,
      "5": 22
    },
    "freeSpinMultiplier": 3
  },
  "high-vol": {
    "id": "high-vol",
    "lines": 20,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 41.29,
          "4": 264.27,
          "5": 1189.21
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 30.97,
          "4": 198.2,
          "5": 891.91
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 24.09,
          "4": 154.16,
          "5": 693.71
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 15.14,
          "4": 97.04,
          "5": 436.32
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 9.63,
          "4": 61.94,
          "5": 277.34
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 6.19,
          "4": 39.92,
          "5": 178.24
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 4.82,
          "4": 30.97,
          "5": 139.02
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 3.44,
          "4": 22.02,
          "5": 99.1
        }
      }
    ],
    "scatterPays": {
      "3": 3.44,
      "4": 17.21,
      "5": 103.23
    },
    "freeSpinsAwarded": {
      "3": 12,
      "4": 18,
      "5": 30
    },
    "freeSpinMultiplier": 5,
    "feature": {
      "kind": "hold-spin",
      "respins": 3
    }
  },
  "classic-3x3": {
    "id": "classic-3x3",
    "lines": 5,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 341.8,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 170.9,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 51.27,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 34.18,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 17.09,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 10.25,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 6.84,
          "4": 0,
          "5": 0
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1,
    "feature": {
      "kind": "wheel",
      "segments": [
        2,
        5,
        10,
        3,
        20,
        5,
        50,
        3
      ]
    }
  },
  "ways-diamond": {
    "id": "ways-diamond",
    "lines": 720,
    "pays": "ways",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 0,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 0.36,
          "4": 1.07,
          "5": 3.56
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 0.26,
          "4": 0.78,
          "5": 2.61
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.53,
          "5": 2.13
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.36,
          "5": 1.42
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.24,
          "5": 0.95
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.18,
          "5": 0.71
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.13,
          "5": 0.52
        }
      }
    ],
    "scatterPays": {
      "3": 0.36,
      "4": 1.78,
      "5": 8.9
    },
    "freeSpinsAwarded": {
      "3": 8,
      "4": 12,
      "5": 20
    },
    "freeSpinMultiplier": 2
  },
  "tumble-20": {
    "id": "tumble-20",
    "lines": 20,
    "pays": "lines",
    "cascade": {
      "ladder": [
        2,
        3,
        5,
        10
      ],
      "maxDrops": 8
    },
    "symbols": [
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 43.96,
          "4": 219.82,
          "5": 879.28
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 32.97,
          "4": 164.87,
          "5": 659.46
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 21.98,
          "4": 109.91,
          "5": 439.64
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 14.29,
          "4": 71.44,
          "5": 285.77
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 8.79,
          "4": 43.96,
          "5": 175.86
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 6.59,
          "4": 32.97,
          "5": 131.89
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 4.4,
          "4": 21.98,
          "5": 87.93
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1
  },
  "classic-3": {
    "id": "classic-3",
    "lines": 1,
    "pays": "lines",
    "symbols": [
      {
        "id": "WILD",
        "kind": "wild",
        "pays": {
          "3": 296.36,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 148.18,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 44.45,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 29.64,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 14.82,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 8.89,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 5.93,
          "4": 0,
          "5": 0
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1
  }
};
