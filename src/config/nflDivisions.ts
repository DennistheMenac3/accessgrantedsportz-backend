// =============================================
// NFL Conference and Division Mappings
// Supports standard teams AND custom teams
// Multiple detection layers for Madden
// custom franchise imports
// =============================================

export const NFL_DIVISIONS: Record<string, {
  conference: string;
  division:   string;
}> = {
  // AFC EAST
  'BUF': { conference: 'AFC', division: 'AFC East' },
  'MIA': { conference: 'AFC', division: 'AFC East' },
  'NE':  { conference: 'AFC', division: 'AFC East' },
  'NYJ': { conference: 'AFC', division: 'AFC East' },

  // AFC NORTH
  'BAL': { conference: 'AFC', division: 'AFC North' },
  'CIN': { conference: 'AFC', division: 'AFC North' },
  'CLE': { conference: 'AFC', division: 'AFC North' },
  'PIT': { conference: 'AFC', division: 'AFC North' },

  // AFC SOUTH
  'HOU': { conference: 'AFC', division: 'AFC South' },
  'IND': { conference: 'AFC', division: 'AFC South' },
  'JAX': { conference: 'AFC', division: 'AFC South' },
  'TEN': { conference: 'AFC', division: 'AFC South' },

  // AFC WEST
  'DEN': { conference: 'AFC', division: 'AFC West' },
  'KC':  { conference: 'AFC', division: 'AFC West' },
  'LV':  { conference: 'AFC', division: 'AFC West' },
  'LAC': { conference: 'AFC', division: 'AFC West' },

  // NFC EAST
  'DAL': { conference: 'NFC', division: 'NFC East' },
  'NYG': { conference: 'NFC', division: 'NFC East' },
  'PHI': { conference: 'NFC', division: 'NFC East' },
  'WAS': { conference: 'NFC', division: 'NFC East' },

  // NFC NORTH
  'CHI': { conference: 'NFC', division: 'NFC North' },
  'DET': { conference: 'NFC', division: 'NFC North' },
  'GB':  { conference: 'NFC', division: 'NFC North' },
  'MIN': { conference: 'NFC', division: 'NFC North' },

  // NFC SOUTH
  'ATL': { conference: 'NFC', division: 'NFC South' },
  'CAR': { conference: 'NFC', division: 'NFC South' },
  'NO':  { conference: 'NFC', division: 'NFC South' },
  'TB':  { conference: 'NFC', division: 'NFC South' },

  // NFC WEST
  'ARI': { conference: 'NFC', division: 'NFC West' },
  'LAR': { conference: 'NFC', division: 'NFC West' },
  'SF':  { conference: 'NFC', division: 'NFC West' },
  'SEA': { conference: 'NFC', division: 'NFC West' },
};

// =============================================
// Name-based fallback mapping
// Catches teams that renamed but kept
// the city/mascot in their name
// =============================================
const NFL_NAME_KEYWORDS: Array<{
  keywords:   string[];
  conference: string;
  division:   string;
}> = [
  // AFC EAST
  { keywords: ['buffalo', 'bills'],
    conference: 'AFC', division: 'AFC East' },
  { keywords: ['miami', 'dolphins'],
    conference: 'AFC', division: 'AFC East' },
  { keywords: ['england', 'patriots', 'new england'],
    conference: 'AFC', division: 'AFC East' },
  { keywords: ['jets', 'new york'],
    conference: 'AFC', division: 'AFC East' },

  // AFC NORTH
  { keywords: ['baltimore', 'ravens'],
    conference: 'AFC', division: 'AFC North' },
  { keywords: ['cincinnati', 'bengals'],
    conference: 'AFC', division: 'AFC North' },
  { keywords: ['cleveland', 'browns'],
    conference: 'AFC', division: 'AFC North' },
  { keywords: ['pittsburgh', 'steelers'],
    conference: 'AFC', division: 'AFC North' },

  // AFC SOUTH
  { keywords: ['houston', 'texans'],
    conference: 'AFC', division: 'AFC South' },
  { keywords: ['indianapolis', 'colts'],
    conference: 'AFC', division: 'AFC South' },
  { keywords: ['jacksonville', 'jaguars'],
    conference: 'AFC', division: 'AFC South' },
  { keywords: ['tennessee', 'titans'],
    conference: 'AFC', division: 'AFC South' },

  // AFC WEST
  { keywords: ['denver', 'broncos'],
    conference: 'AFC', division: 'AFC West' },
  { keywords: ['kansas', 'chiefs', 'kansas city'],
    conference: 'AFC', division: 'AFC West' },
  { keywords: ['las vegas', 'raiders', 'oakland'],
    conference: 'AFC', division: 'AFC West' },
  { keywords: ['chargers', 'los angeles', 'san diego'],
    conference: 'AFC', division: 'AFC West' },

  // NFC EAST
  { keywords: ['dallas', 'cowboys'],
    conference: 'NFC', division: 'NFC East' },
  { keywords: ['giants', 'new york g'],
    conference: 'NFC', division: 'NFC East' },
  { keywords: ['philadelphia', 'eagles'],
    conference: 'NFC', division: 'NFC East' },
  { keywords: ['washington', 'commanders', 'redskins'],
    conference: 'NFC', division: 'NFC East' },

  // NFC NORTH
  { keywords: ['chicago', 'bears'],
    conference: 'NFC', division: 'NFC North' },
  { keywords: ['detroit', 'lions'],
    conference: 'NFC', division: 'NFC North' },
  { keywords: ['green bay', 'packers'],
    conference: 'NFC', division: 'NFC North' },
  { keywords: ['minnesota', 'vikings'],
    conference: 'NFC', division: 'NFC North' },

  // NFC SOUTH
  { keywords: ['atlanta', 'falcons'],
    conference: 'NFC', division: 'NFC South' },
  { keywords: ['carolina', 'panthers'],
    conference: 'NFC', division: 'NFC South' },
  { keywords: ['orleans', 'saints', 'new orleans'],
    conference: 'NFC', division: 'NFC South' },
  { keywords: ['tampa', 'buccaneers', 'bucs'],
    conference: 'NFC', division: 'NFC South' },

  // NFC WEST
  { keywords: ['arizona', 'cardinals'],
    conference: 'NFC', division: 'NFC West' },
  { keywords: ['rams', 'st. louis'],
    conference: 'NFC', division: 'NFC West' },
  { keywords: ['francisco', '49ers', 'san francisco'],
    conference: 'NFC', division: 'NFC West' },
  { keywords: ['seattle', 'seahawks'],
    conference: 'NFC', division: 'NFC West' },
];

// =============================================
// Layer 1 — Exact abbreviation match
// =============================================
export const getDivisionByAbbreviation = (
  abbreviation: string
): { conference: string; division: string } | null => {
  return NFL_DIVISIONS[abbreviation?.toUpperCase()] || null;
};

// =============================================
// Layer 2 — Name keyword matching
// For custom teams that kept city/mascot
// =============================================
export const getDivisionByName = (
  teamName: string
): { conference: string; division: string } | null => {
  if (!teamName) return null;
  const lower = teamName.toLowerCase();

  for (const entry of NFL_NAME_KEYWORDS) {
    if (entry.keywords.some(keyword => lower.includes(keyword))) {
      return {
        conference: entry.conference,
        division:   entry.division
      };
    }
  }
  return null;
};

// =============================================
// MAIN — Get division info using all layers
// Tries abbreviation first then name
// =============================================
export const getDivisionInfo = (
  abbreviation: string,
  teamName?:    string
): { conference: string; division: string } | null => {
  // Layer 1 — abbreviation
  const byAbbr = getDivisionByAbbreviation(abbreviation);
  if (byAbbr) return byAbbr;

  // Layer 2 — name keywords
  if (teamName) {
    const byName = getDivisionByName(teamName);
    if (byName) return byName;
  }

  // Layer 3 — return null
  // Commissioner will assign manually
  return null;
};

// =============================================
// Check if two teams are division rivals
// =============================================
export const areDivisionRivals = (
  abbr1: string,
  abbr2: string,
  name1?: string,
  name2?: string
): boolean => {
  const team1 = getDivisionInfo(abbr1, name1);
  const team2 = getDivisionInfo(abbr2, name2);
  if (!team1 || !team2) return false;
  return team1.division === team2.division;
};

// =============================================
// Check if conference rivals
// =============================================
export const areConferenceRivals = (
  abbr1: string,
  abbr2: string,
  name1?: string,
  name2?: string
): boolean => {
  const team1 = getDivisionInfo(abbr1, name1);
  const team2 = getDivisionInfo(abbr2, name2);
  if (!team1 || !team2) return false;
  return team1.conference === team2.conference;
};

// =============================================
// Get rivalry label for narratives
// =============================================
export const getRivalryLabel = (
  abbr1: string,
  abbr2: string,
  name1?: string,
  name2?: string
): string => {
  if (areDivisionRivals(abbr1, abbr2, name1, name2)) {
    return 'DIVISION RIVALRY';
  }
  if (areConferenceRivals(abbr1, abbr2, name1, name2)) {
    return 'CONFERENCE MATCHUP';
  }
  return 'INTERCONFERENCE';
};