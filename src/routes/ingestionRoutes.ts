import { Router } from 'express';
import { query } from '../config/database';
import { ingestTeams, ingestPlayers, ingestGames } from '../services/maddenIngestionService';
import { autoPostGameRecap, autoPostAwardUpdate } from '../services/schedulerService';
import { calculateAllAwards } from '../services/awardsService';

const router = Router();

// Helper to find arrays in EA's messy JSON
const extractData = (body: any, possibleKeys: string[]) => {
  if (!body) return [];
  for (const key of possibleKeys) {
    if (Array.isArray(body[key])) return body[key];
    if (body[key] && typeof body[key] === 'object') {
      const firstChild = Object.values(body[key])[0];
      if (Array.isArray(firstChild)) return firstChild;
    }
  }
  return [];
};

router.post('/madden/:leagueId/:apiKey/*', async (req: any, res: any) => {
  try {
    const leagueId = req.params.leagueId?.trim().replace(/%20/g, '');
    const apiKey = req.params.apiKey?.trim().replace(/%20/g, '');
    const data = req.body || {};

    const authResult = await query(
      `SELECT * FROM leagues WHERE id = $1 AND api_key = $2`,
      [leagueId, apiKey]
    );

    if (authResult.rows.length === 0) return res.status(401).json({ success: false });

    const league = authResult.rows[0];
    const season = league.season || 1;

    const teams = extractData(data, ['leagueTeamInfoList', 'teamInfoList', 'teams']);
    const players = extractData(data, ['rosterInfoList', 'playerInfoList', 'rosters', 'playerInfo']);
    const scores = extractData(data, ['scheduleInfoList', 'gameInfoList', 'scores']);

    console.log(`[EA INGEST] 🔎 Found: ${teams.length} teams, ${players.length} players, ${scores.length} games`);

    if (teams.length === 0 && players.length === 0 && scores.length === 0) {
      return res.status(200).json({ success: true, message: 'Heartbeat received.' });
    }

    if (teams.length > 0) {
      await ingestTeams(leagueId, teams);
    }
    
    if (players.length > 0) {
      const teamsRes = await query(`SELECT id, madden_id FROM teams WHERE league_id = $1`, [leagueId]);
      const teamIdMap = new Map();
      teamsRes.rows.forEach((t: any) => teamIdMap.set(t.madden_id, t.id));
      await ingestPlayers(leagueId, season, players, teamIdMap);
    }

    if (scores.length > 0) {
      const teamsRes = await query(`SELECT id, madden_id FROM teams WHERE league_id = $1`, [leagueId]);
      const teamIdMap = new Map();
      teamsRes.rows.forEach((t: any) => teamIdMap.set(t.madden_id, t.id));

      const playersRes = await query(`SELECT id, madden_id FROM players WHERE league_id = $1`, [leagueId]);
      const playerIdMap = new Map();
      playersRes.rows.forEach((p: any) => playerIdMap.set(p.madden_id, p.id));

      await ingestGames(leagueId, scores, teamIdMap, playerIdMap);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[EA INGEST] 💥 Crash:', error);
    res.status(500).json({ success: false });
  }
});

export default router;