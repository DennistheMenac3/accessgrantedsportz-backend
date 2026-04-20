import { Router } from 'express';
import { query } from '../config/database';
import {
  ingestTeams,
  ingestPlayers,
  ingestGames
} from '../services/maddenIngestionService';
import {
  autoPostGameRecap,
  autoPostAwardUpdate
} from '../services/schedulerService';
import { calculateAllAwards } from '../services/awardsService';

const router = Router();

// =============================================
// THE EA COMPANION APP CATCH-ALL ENDPOINT
// Catches /madden/:leagueId/:apiKey/ANYTHING_EA_APPENDS
// =============================================
router.post(
  '/madden/:leagueId/:apiKey/*',
  async (req: any, res: any) => {
    try {
      // 1. Extract and sanitize URL parameters to remove hidden EA whitespace
      const leagueId = req.params.leagueId?.trim();
      const apiKey = req.params.apiKey?.trim();
      const data = req.body || {}; // Fallback to empty object if body is missing

      console.log(`\n[EA INGEST] 🚨 New Request Received!`);
      console.log(`[EA INGEST] Path: ${req.path}`);
      console.log(`[EA INGEST] League ID: '${leagueId}'`);
      console.log(`[EA INGEST] API Key: '${apiKey}'`);
      console.log(`[EA INGEST] Payload Size: ${JSON.stringify(data).length} bytes`);

      // 2. Validate the API Key
      const authResult = await query(
        `SELECT * FROM leagues WHERE id = $1 AND api_key = $2`,
        [leagueId, apiKey]
      );

      if (authResult.rows.length === 0) {
        console.log(`[EA INGEST] ❌ Auth Failed! No match in database.`);
        res.status(401).json({
          success: false,
          message: 'Invalid league ID or API key'
        });
        return;
      }

      console.log(`[EA INGEST] ✅ Auth Successful for ${authResult.rows[0].name}`);

      const league = authResult.rows[0];
      const season = league.season || 1;
      const channelId = league.discord_channel_id;

      // 3. Identify the incoming payload safely (using optional chaining ?.)
      const teams = data?.leagueTeamInfoList?.leagueTeamInfo || data?.teamInfoList?.teamInfo || data?.teams || [];
      const players = data?.rosterInfoList?.playerInfo || data?.playerInfoList?.playerInfo || data?.rosters || [];
      const scores = data?.scheduleInfoList?.scheduleInfo || data?.gameInfoList?.gameInfo || data?.scores || [];

      if (teams.length === 0 && players.length === 0 && scores.length === 0) {
        console.log(`[EA INGEST] ⚠️ Unrecognized or empty payload.`);
        res.status(400).json({ success: false, message: 'Unrecognized export payload.' });
        return;
      }

      const processedItems: string[] = [];

      // 4. Process Teams
      if (teams.length > 0) {
        console.log(`[EA INGEST] ⚙️ Processing ${teams.length} teams...`);
        const { created, updated } = await ingestTeams(leagueId, teams);
        console.log(`[EA INGEST] ✅ Teams: ${created} created, ${updated} updated`);
        processedItems.push('Teams');
      }

      // 5. Process Rosters
      if (players.length > 0) {
        console.log(`[EA INGEST] ⚙️ Processing ${players.length} players...`);
        const teamsResult = await query(`SELECT id, madden_id FROM teams WHERE league_id = $1`, [leagueId]);
        const teamIdMap = new Map<number, string>();
        teamsResult.rows.forEach((t: any) => {
          if (t.madden_id !== null) teamIdMap.set(t.madden_id, t.id);
        });

        const { created, updated } = await ingestPlayers(leagueId, season, players, teamIdMap);
        console.log(`[EA INGEST] ✅ Rosters: ${created} created, ${updated} updated`);
        processedItems.push('Rosters');
      }

      // 6. Process Weekly Stats
      if (scores.length > 0) {
        console.log(`[EA INGEST] ⚙️ Processing ${scores.length} games...`);
        const teamsResult = await query(`SELECT id, madden_id FROM teams WHERE league_id = $1`, [leagueId]);
        const teamIdMap = new Map<number, string>();
        teamsResult.rows.forEach((t: any) => {
          if (t.madden_id !== null) teamIdMap.set(t.madden_id, t.id);
        });

        const playersResult = await query(`SELECT id, madden_id FROM players WHERE league_id = $1`, [leagueId]);
        const playerIdMap = new Map<number, string>();
        playersResult.rows.forEach((p: any) => {
          if (p.madden_id !== null) playerIdMap.set(p.madden_id, p.id);
        });

        const { created, statsProcessed } = await ingestGames(leagueId, scores, teamIdMap, playerIdMap);
        console.log(`[EA INGEST] ✅ Stats: ${created} games created, ${statsProcessed} stats logged`);
        processedItems.push('Weekly Stats');

        // Trigger Discord integrations asynchronously
        if (channelId) {
          try {
            await calculateAllAwards(leagueId, season);
            const recentGames = await query(
              `SELECT id FROM games WHERE league_id = $1 AND created_at > NOW() - INTERVAL '5 minutes'`,
              [leagueId]
            );
            for (const game of recentGames.rows) {
              await autoPostGameRecap(leagueId, game.id, season, channelId);
              await new Promise(r => setTimeout(r, 2000));
            }
            await autoPostAwardUpdate(leagueId, channelId, season);
          } catch (discordError) {
            console.error('[EA INGEST] Discord auto-post error:', discordError);
          }
        }
      }

      res.status(200).json({
        success: true,
        message: `Successfully processed: ${processedItems.join(', ')}`
      });

    } catch (error) {
      console.error('[EA INGEST] 💥 Server Error processing export:', error);
      res.status(500).json({ success: false, message: 'Server error processing export' });
    }
  }
);

export default router;