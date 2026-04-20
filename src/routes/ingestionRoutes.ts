import { Router } from 'express';
import { query } from '../config/database';
import { ingestTeams, ingestPlayers, ingestGames } from '../services/maddenIngestionService';

const router = Router();

/**
 * THE NEON-STYLE CATCH-ALL
 * This matches any path that starts with your league and key.
 * Anything EA appends after the key (like /ps5/20036315/roster) 
 * will be captured by the '*' and safely ignored.
 */
router.post('/madden/:leagueId/:apiKey/*', async (req: any, res: any) => {
  try {
    // 1. Sanitize the URL to remove the %20 spaces Madden often adds
    const leagueId = req.params.leagueId?.trim().replace(/%20/g, '');
    const apiKey = req.params.apiKey?.trim().replace(/%20/g, '');
    const data = req.body || {};

    // 2. Database Auth Check
    const authResult = await query(
      `SELECT * FROM leagues WHERE id = $1 AND api_key = $2`,
      [leagueId, apiKey]
    );

    if (authResult.rows.length === 0) {
      console.log(`[EA INGEST] ❌ Unauthorized: League ${leagueId} / Key ${apiKey}`);
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const league = authResult.rows[0];
    const season = league.season || 1;

    // 3. Identify Payload (Mimicking industry-standard data detection)
    const teams = data?.leagueTeamInfoList?.leagueTeamInfo || data?.teamInfoList?.teamInfo || data?.teams || [];
    const players = data?.rosterInfoList?.playerInfo || data?.playerInfoList?.playerInfo || data?.rosters || [];
    const scores = data?.scheduleInfoList?.scheduleInfo || data?.gameInfoList?.gameInfo || data?.scores || [];

    // 4. Silence 400 Errors
    // Many Madden files (kicking, punting) aren't used. We return 200 OK 
    // so the app sees a green checkmark, even if we don't save the data.
    if (teams.length === 0 && players.length === 0 && scores.length === 0) {
      console.log(`[EA INGEST] ℹ️ Ignored irrelevant file: ${req.path}`);
      return res.status(200).json({ success: true, message: 'Acknowledged' });
    }

    // 5. Execution
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
      // (Your existing ingestGames logic goes here)
    }

    console.log(`[EA INGEST] ✅ Success: ${req.path}`);
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('[EA INGEST] 💥 Crash:', error);
    res.status(500).json({ success: false });
  }
});

export default router;