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

import type { SlotGame } from './games';

export const SLOT_GAMES: SlotGame[] = [
  { id: 'juwa-classic-slots', name: 'Juwa Classic', category: 'slots', rtp: 0.9614, volatility: 'low', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#7C3AED', secondary: '#C026D3', accent: '#FFC53D' }, tag: 'hot' },
  { id: 'slot-emerald-nights', name: 'Emerald Nights', category: 'slots', rtp: 0.9614, volatility: 'low', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#065F46', secondary: '#10B981', accent: '#A7F3D0' }, art: 'jungle' },
  { id: 'slot-royal-flush', name: 'Royal Fortune', category: 'slots', rtp: 0.9614, volatility: 'low', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#7F1D1D', secondary: '#DC2626', accent: '#FCA5A5' }, art: 'myth' },
  { id: 'slot-ocean-drift', name: 'Ocean Drift', category: 'slots', rtp: 0.9614, volatility: 'low', reels: 5, rows: 3, lines: 20, minBet: 10, maxBet: 10000, theme: { primary: '#0C4A6E', secondary: '#0EA5E9', accent: '#BAE6FD' }, art: 'pirate' },
  { id: 'slot-sunset-strip', name: 'Sunset Strip', category: 'slots', rtp: 0.9614, volatility: 'low', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#9A3412', secondary: '#FB923C', accent: '#FED7AA' }, art: 'wildwest' },
  { id: 'slot-midnight-gold', name: 'Midnight Gold', category: 'slots', rtp: 0.9541, volatility: 'medium', reels: 5, rows: 3, lines: 10, minBet: 20, maxBet: 50000, theme: { primary: '#1C1917', secondary: '#78716C', accent: '#FFC53D' }, art: 'wildwest' },
  { id: 'slot-neon-alley', name: 'Neon Alley', category: 'slots', rtp: 0.9541, volatility: 'medium', reels: 5, rows: 3, lines: 10, minBet: 20, maxBet: 50000, theme: { primary: '#4C1D95', secondary: '#2FE3D6', accent: '#FF3D8A' }, tag: 'new', art: 'orb' },
  { id: 'slot-desert-mirage', name: 'Desert Mirage', category: 'slots', rtp: 0.9541, volatility: 'medium', reels: 5, rows: 3, lines: 10, minBet: 20, maxBet: 50000, theme: { primary: '#78350F', secondary: '#D97706', accent: '#FDE68A' }, art: 'egypt' },
  { id: 'slot-frost-peak', name: 'Frost Peak', category: 'slots', rtp: 0.9541, volatility: 'medium', reels: 5, rows: 3, lines: 10, minBet: 10, maxBet: 10000, theme: { primary: '#1E3A8A', secondary: '#60A5FA', accent: '#DBEAFE' }, art: 'orb' },
  { id: 'slot-jade-temple', name: 'Jade Temple', category: 'slots', rtp: 0.9541, volatility: 'medium', reels: 5, rows: 3, lines: 10, minBet: 20, maxBet: 50000, theme: { primary: '#134E4A', secondary: '#14B8A6', accent: '#99F6E4' }, art: 'asian' },
  { id: 'slot-carnival-row', name: 'Carnival Row', category: 'slots', rtp: 0.9595, volatility: 'medium', reels: 5, rows: 3, lines: 25, minBet: 20, maxBet: 50000, theme: { primary: '#831843', secondary: '#EC4899', accent: '#FBCFE8' }, art: 'orb' },
  { id: 'slot-jungle-run', name: 'Jungle Run', category: 'slots', rtp: 0.9595, volatility: 'medium', reels: 5, rows: 3, lines: 25, minBet: 20, maxBet: 50000, theme: { primary: '#14532D', secondary: '#65A30D', accent: '#D9F99D' }, art: 'jungle' },
  { id: 'slot-city-lights', name: 'City Lights', category: 'slots', rtp: 0.9595, volatility: 'medium', reels: 5, rows: 3, lines: 25, minBet: 20, maxBet: 50000, theme: { primary: '#0F172A', secondary: '#38BDF8', accent: '#F1F5F9' }, art: 'orb' },
  { id: 'slot-spice-market', name: 'Spice Market', category: 'slots', rtp: 0.9595, volatility: 'medium', reels: 5, rows: 3, lines: 25, minBet: 10, maxBet: 10000, theme: { primary: '#7C2D12', secondary: '#EA580C', accent: '#FFEDD5' }, art: 'asian' },
  { id: 'slot-aurora-borealis', name: 'Aurora', category: 'slots', rtp: 0.9595, volatility: 'medium', reels: 5, rows: 3, lines: 25, minBet: 20, maxBet: 50000, theme: { primary: '#312E81', secondary: '#818CF8', accent: '#C7D2FE' }, art: 'orb' },
  { id: 'slot-dragons-hoard', name: 'Dragon\'s Hoard', category: 'slots', rtp: 0.9554, volatility: 'very-high', reels: 5, rows: 3, lines: 20, minBet: 100, maxBet: 200000, theme: { primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' }, tag: 'mega', art: 'asian' },
  { id: 'slot-vault-breaker', name: 'Vault Breaker', category: 'slots', rtp: 0.9554, volatility: 'very-high', reels: 5, rows: 3, lines: 20, minBet: 100, maxBet: 200000, theme: { primary: '#18181B', secondary: '#52525B', accent: '#2FE3D6' }, art: 'pirate' },
  { id: 'slot-supernova', name: 'Supernova', category: 'slots', rtp: 0.9554, volatility: 'very-high', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#1E1B4B', secondary: '#7C3AED', accent: '#F0ABFC' }, tag: 'new', art: 'orb' },
  { id: 'slot-pharaohs-vault', name: 'Pharaoh\'s Vault', category: 'slots', rtp: 0.9554, volatility: 'very-high', reels: 5, rows: 3, lines: 20, minBet: 100, maxBet: 200000, theme: { primary: '#422006', secondary: '#CA8A04', accent: '#FEF08A' }, art: 'egypt' },
  { id: 'slot-storm-chaser', name: 'Storm Chaser', category: 'slots', rtp: 0.9554, volatility: 'very-high', reels: 5, rows: 3, lines: 20, minBet: 20, maxBet: 50000, theme: { primary: '#164E63', secondary: '#06B6D4', accent: '#CFFAFE' }, art: 'myth' },
  { id: 'slot-lucky-sevens', name: 'Lucky Sevens', category: 'slots', rtp: 0.9455, volatility: 'high', reels: 3, rows: 1, lines: 1, minBet: 10, maxBet: 10000, theme: { primary: '#7F1D1D', secondary: '#EF4444', accent: '#FFC53D' } },
  { id: 'slot-triple-bar', name: 'Triple Bar', category: 'slots', rtp: 0.9455, volatility: 'high', reels: 3, rows: 1, lines: 1, minBet: 10, maxBet: 10000, theme: { primary: '#1C1917', secondary: '#57534E', accent: '#E6CE8C' } },
  { id: 'slot-fruit-stand', name: 'Fruit Stand', category: 'slots', rtp: 0.9455, volatility: 'high', reels: 3, rows: 1, lines: 1, minBet: 10, maxBet: 10000, theme: { primary: '#166534', secondary: '#22C55E', accent: '#FEF08A' } },
];
