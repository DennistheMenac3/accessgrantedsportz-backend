import { Router } from 'express';
import { query } from '../config/database';
import { ingestTeams, ingestPlayers, ingestGames } from '../services/maddenIngestionService';

const router = Router();

// Helper to find data regardless of how deeply EA nests it
const extractData = (body: any, possibleKeys: string[]) => {
  if (!body) return [];
  for (const key of possibleKeys) {
    if (Array.isArray(body[key])) return body[key];
    // Check one level deeper (Madden often does leagueTeamInfoList.leagueTeamInfo)
    if (body[key] && Array.isArray(body[key][Object.keys(body[key])[0]])) {
        return body[key][Object.keys(body[key])[0]];
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

    // 1. Broad detection of Madden data keys
    const teams = extractData(data, ['leagueTeamInfoList', 'teamInfoList', 'teams', 'teamInfo']);
    const players = extractData(data, ['rosterInfoList', 'playerInfoList', 'rosters', 'playerInfo']);
    const scores = extractData(data, ['scheduleInfoList', 'gameInfoList', 'scores']);

    // 2. Log exactly what we found so we can debug the Railway logs
    console.log(`[EA INGEST] 🔎 Detection: ${teams.length} teams, ${players.length} players, ${scores.length} games`);

    if (teams.length === 0 && players.length === 0 && scores.length === 0) {
      return res.status(200).json({ success: true, message: 'Received, but no actionable data found.' });
    }

    // 3. IMPORTANT: Process Teams FIRST
    if (teams.length > 0) {
      console.log(`[EA INGEST] 🚀 Saving ${teams.length} teams to DB...`);
      await ingestTeams(leagueId, teams);
    }
    
    // 4. Process Players (only if we have teams in the DB)
    if (players.length > 0) {
      const teamsRes = await query(`SELECT id, madden_id FROM teams WHERE league_id = $1`, [leagueId]);
      
      if (teamsRes.rows.length === 0) {
        console.log(`[EA INGEST] 🛑 ABORT: Cannot save players because the TEAMS table is empty. Export League Info first!`);
        return res.status(200).json({ success: true, message: 'Teams missing. Export teams first.' });
      }

      const teamIdMap = new Map();
      teamsRes.rows.forEach((t: any) => teamIdMap.set(t.madden_id, t.id));
      
      console.log(`[EA INGEST] 🚀 Saving ${players.length} players to DB...`);
      await ingestPlayers(leagueId, season, players, teamIdMap);
    }

    // 5. Process Games
    if (scores.length > 0) {
      // (Your existing ingestGames logic)
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('[EA INGEST] 💥 Crash:', error);
    res.status(500).json({ success: false });
  }
});

export default router;