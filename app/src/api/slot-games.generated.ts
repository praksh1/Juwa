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
  { id: 'slot-triple-bar', name: 'Triple Bar', category: 'slots', rtp: 0.9479, volatility: 'medium', reels: 3, rows: [3, 3, 3], lines: 5, pays: 'lines', feature: 'wheel', minBet: 10, maxBet: 10000, theme: { primary: '#1C1917', secondary: '#57534E', accent: '#E6CE8C' }, model: 'classic-3x3', art: 'fruit' },
  { id: 'slot-fruit-stand', name: 'Fruit Stand', category: 'slots', rtp: 0.9479, volatility: 'medium', reels: 3, rows: [3, 3, 3], lines: 5, pays: 'lines', feature: 'wheel', minBet: 10, maxBet: 10000, theme: { primary: '#166534', secondary: '#22C55E', accent: '#FEF08A' }, model: 'classic-3x3', art: 'fruit' },
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
    "freeSpinMultiplier": 3,
    "tiers": {
      "big": 3.3,
      "mega": 15.6,
      "jackpot": 55.9
    }
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
          "3": 28.619999999999997,
          "4": 131.652,
          "5": 592.434
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 21.465,
          "4": 98.73899999999999,
          "5": 444.087
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 16.695,
          "4": 76.797,
          "5": 345.825
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 10.494,
          "4": 48.177,
          "5": 217.035
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 6.678,
          "4": 30.528,
          "5": 138.32999999999998
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 4.293,
          "4": 19.557,
          "5": 88.722
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 3.339,
          "4": 15.264,
          "5": 69.16499999999999
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 2.385,
          "4": 10.971,
          "5": 49.131
        }
      }
    ],
    "scatterPays": {
      "3": 1.908,
      "4": 8.586,
      "5": 42.93
    },
    "freeSpinsAwarded": {
      "3": 10,
      "4": 15,
      "5": 25
    },
    "freeSpinMultiplier": 3,
    "tiers": {
      "big": 4,
      "mega": 19.1,
      "jackpot": 60.7
    },
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
          "3": 54.288000000000004,
          "4": 228.0096,
          "5": 1026.0432
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 40.716,
          "4": 171.0072,
          "5": 769.9848000000001
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 31.668000000000003,
          "4": 133.00560000000002,
          "5": 598.9776
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 19.9056,
          "4": 83.2416,
          "5": 376.39680000000004
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 12.667200000000001,
          "4": 53.3832,
          "5": 239.77200000000002
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 8.1432,
          "4": 34.382400000000004,
          "5": 153.816
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 6.333600000000001,
          "4": 26.2392,
          "5": 119.43360000000001
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 4.524,
          "4": 19.0008,
          "5": 85.956
        }
      }
    ],
    "scatterPays": {
      "3": 2.7144000000000004,
      "4": 12.667200000000001,
      "5": 63.336000000000006
    },
    "freeSpinsAwarded": {
      "3": 8,
      "4": 14,
      "5": 22
    },
    "freeSpinMultiplier": 3,
    "tiers": {
      "big": 3.8,
      "mega": 15.1,
      "jackpot": 48.4
    }
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
          "3": 41.292,
          "4": 264.2688,
          "5": 1189.2096000000001
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 30.969,
          "4": 198.2016,
          "5": 891.9072
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 24.087,
          "4": 154.1568,
          "5": 693.7056
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 15.140400000000001,
          "4": 97.03620000000001,
          "5": 436.3188
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 9.6348,
          "4": 61.938,
          "5": 277.3446
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 6.1938,
          "4": 39.915600000000005,
          "5": 178.24380000000002
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 4.8174,
          "4": 30.969,
          "5": 139.0164
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 3.4410000000000003,
          "4": 22.0224,
          "5": 99.1008
        }
      }
    ],
    "scatterPays": {
      "3": 3.4410000000000003,
      "4": 17.205000000000002,
      "5": 103.23
    },
    "freeSpinsAwarded": {
      "3": 12,
      "4": 18,
      "5": 30
    },
    "freeSpinMultiplier": 5,
    "tiers": {
      "big": 3.8,
      "mega": 15.9,
      "jackpot": 46.9
    },
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
          "3": 416.92,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "SEVEN",
        "kind": "normal",
        "pays": {
          "3": 208.46,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 62.538,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 41.692,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 20.846,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 12.5076,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 8.3384,
          "4": 0,
          "5": 0
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1,
    "tiers": {
      "big": 4.2,
      "mega": 12.5,
      "jackpot": 44.2
    },
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
          "3": 0.3558,
          "4": 1.0674,
          "5": 3.558
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 0.26092000000000004,
          "4": 0.78276,
          "5": 2.6092
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.5337,
          "5": 2.1348
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.3558,
          "5": 1.4232
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.2372,
          "5": 0.9488
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.1779,
          "5": 0.7116
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 0,
          "4": 0.13046000000000002,
          "5": 0.5218400000000001
        }
      }
    ],
    "scatterPays": {
      "3": 0.3558,
      "4": 1.779,
      "5": 8.895
    },
    "freeSpinsAwarded": {
      "3": 8,
      "4": 12,
      "5": 20
    },
    "freeSpinMultiplier": 2,
    "tiers": {
      "big": 3.1,
      "mega": 11.6,
      "jackpot": 27.9
    }
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
          "3": 43.964,
          "4": 219.82,
          "5": 879.28
        }
      },
      {
        "id": "DIAMOND",
        "kind": "normal",
        "pays": {
          "3": 32.973,
          "4": 164.865,
          "5": 659.46
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 21.982,
          "4": 109.91,
          "5": 439.64
        }
      },
      {
        "id": "BAR",
        "kind": "normal",
        "pays": {
          "3": 14.2883,
          "4": 71.44149999999999,
          "5": 285.76599999999996
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 8.7928,
          "4": 43.964,
          "5": 175.856
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 6.5946,
          "4": 32.973,
          "5": 131.892
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 4.3964,
          "4": 21.982,
          "5": 87.928
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1,
    "tiers": {
      "big": 4.4,
      "mega": 18,
      "jackpot": 52.9
    }
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
          "3": 44.454,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "BELL",
        "kind": "normal",
        "pays": {
          "3": 29.636,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "CHERRY",
        "kind": "normal",
        "pays": {
          "3": 14.818,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "PLUM",
        "kind": "normal",
        "pays": {
          "3": 8.8908,
          "4": 0,
          "5": 0
        }
      },
      {
        "id": "LEMON",
        "kind": "normal",
        "pays": {
          "3": 5.9272,
          "4": 0,
          "5": 0
        }
      }
    ],
    "scatterPays": {},
    "freeSpinsAwarded": {},
    "freeSpinMultiplier": 1,
    "tiers": {
      "big": 5.9,
      "mega": 29.6,
      "jackpot": 65.1
    }
  }
};
