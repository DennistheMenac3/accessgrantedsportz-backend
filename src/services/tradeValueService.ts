import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * RECALIBRATED TRADE VALUE SYSTEM (TVS 2.0)
 * Goal: Exponential OVR scaling, flat bonuses, and fixed pick anchors.
 */

export const getMacroPosition = (pos: string): string => {
  const p = (pos || '').toUpperCase().trim();
  const olPositions = ['LT', 'LG', 'C', 'RG', 'RT'];
  const dlPositions = ['LE', 'RE', 'DT', 'LEDG', 'REDG', 'LEDGE', 'REDGE'];
  const lbPositions = ['LOLB', 'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL'];
  const sPositions  = ['FS', 'SS'];

  if (olPositions.includes(p)) return 'OL';
  if (dlPositions.includes(p)) return 'DL';
  if (lbPositions.includes(p)) return 'LB';
  if (sPositions.includes(p))  return 'S';
  return p;
};

// 1. NON-LINEAR OVR CURVE
// This ensures the gap between 80 and 90 is much larger than 60 and 70.
const calculateBaseTVS = (ovr: number): number => {
  // Formula: (OVR/10)^2.8 - creates a steep value curve
  return Math.round(Math.pow(ovr / 10, 2.8) * 10) / 10;
  // 60 OVR = 151 | 70 OVR = 230 | 80 OVR = 333 | 90 OVR = 464 | 99 OVR = 609
};

// 2. FLAT AGE BONUSES (No more multipliers!)
const getAgeBonus = (age: number): number => {
  if (age <= 21) return 80;
  if (age === 22) return 65;
  if (age === 23) return 50; // Mike Tyson's age
  if (age === 24) return 35;
  if (age === 25) return 20;
  if (age === 26) return 10;
  if (age === 27) return 0;
  return (27 - age) * 15; // Penalty for players 28+
};

// 3. DEV TRAIT FLAT VALUES
const getDevBonus = (dev: string): number => {
  const devMap: { [key: string]: number } = {
    'normal': 0,
    'star': 40,
    'superstar': 120,
    'xfactor': 250
  };
  return devMap[dev.toLowerCase()] || 0;
};

// 4. POSITION PREMIUMS (Flat adjustments)
const getPositionPremium = (pos: string): number => {
  const premiums: { [key: string]: number } = {
    'QB': 150,
    'CB': 40,
    'WR': 30,
    'DL': 25,
    'LB': 10,
    'OL': 15,
    'S': 5
  };
  return premiums[pos] || 0;
};

// 5. THRESHOLD-BASED SPEED BONUSES
const calculateSpeedBonus = (pos: string, spd: number): number => {
  if (pos === 'LB') {
    if (spd >= 92) return 60;
    if (spd >= 90) return 30;
    if (spd >= 88) return 10;
    if (spd >= 85) return 0;
    return -40; // Mike Tyson (84) now gets a significant penalty
  }
  if (pos === 'DL') {
    if (spd >= 85) return 50;
    if (spd >= 80) return 25;
    if (spd >= 75) return 0;
    return -20;
  }
  // Add other positions as needed...
  return 0;
};

// 6. DRAFT PICK ANCHORS
const getPickValue = (round: number, tier: 'high' | 'mid' | 'low' = 'mid'): number => {
  const pickMap: { [key: number]: number } = {
    1: 450, // Mid 1st rounder
    2: 180,
    3: 80,
    4: 40,
    5: 20,
    6: 10,
    7: 5
  };
  return pickMap[round] || 0;
};

export const calculateTradeValue = async (
  playerId: string,
  leagueId: string
): Promise<{ total_value: number; breakdown: any }> => {
  const playerResult = await query(`SELECT * FROM players WHERE id = $1`, [playerId]);
  const player = playerResult.rows[0];
  const macroPos = getMacroPosition(player.position);

  const base = calculateBaseTVS(player.overall_rating);
  const ageB = getAgeBonus(player.age);
  const devB = getDevBonus(player.dev_trait);
  const posB = getPositionPremium(macroPos);
  const spdB = calculateSpeedBonus(macroPos, player.speed);

  const totalValue = base + ageB + devB + posB + spdB;

  return {
    total_value: Math.max(1, totalValue), // Ensure value isn't negative
    breakdown: { base, ageB, devB, posB, spdB }
  };
};