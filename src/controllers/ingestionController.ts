import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import {
  ingestTeams,
  ingestPlayers,
  ingestGames
} from '../services/maddenIngestionService';

// =============================================
// MADDEN INGESTION ENDPOINT
// POST /api/ingest/madden/:leagueId
// Receives a full Madden Companion App export
// and populates the entire database
// =============================================
export const ingestMaddenData = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const startTime = Date.now();

  try {
    const leagueId = req.params.leagueId as string;
    const { leagueInfo, teams, rosters, scores } = req.body;

    // Validate payload
    if (!leagueInfo || !teams || !rosters) {
      res.status(400).json({
        success: false,
        message: 'Invalid Madden export. Required: leagueInfo, teams, rosters'
      });
      return;
    }

    console.log(`🏈 Starting Madden ingestion for league: ${leagueId}`);
    console.log(`   Teams:   ${teams.length}`);
    console.log(`   Players: ${rosters.length}`);
    console.log(`   Games:   ${scores?.length || 0}`);

    // Step 1 — Ingest teams
    console.log('📥 Ingesting teams...');
    const teamResult = await ingestTeams(leagueId, teams);
    console.log(`   ✅ Teams: ${teamResult.created} created, ${teamResult.updated} updated`);

    // Step 2 — Ingest players
    console.log('📥 Ingesting players...');
    const season = leagueInfo.seasonIndex || 1;
    const playerResult = await ingestPlayers(
      leagueId,
      season,
      rosters,
      teamResult.teamIdMap
    );
    console.log(`   ✅ Players: ${playerResult.created} created, ${playerResult.updated} updated`);

    // Step 3 — Ingest games and stats
    let gameResult = { created: 0, statsProcessed: 0 };
    if (scores && scores.length > 0) {
      console.log('📥 Ingesting games and stats...');
      gameResult = await ingestGames(
        leagueId,
        scores,
        teamResult.teamIdMap,
        playerResult.playerIdMap
      );
      console.log(`   ✅ Games: ${gameResult.created} created`);
      console.log(`   ✅ Stats: ${gameResult.statsProcessed} player stat lines processed`);
    }

    const duration = Date.now() - startTime;

    console.log(`🎉 Ingestion complete in ${duration}ms`);

    res.status(200).json({
      success: true,
      message: 'Madden data ingested successfully',
      summary: {
        duration_ms: duration,
        season: season,
        teams: {
          created: teamResult.created,
          updated: teamResult.updated,
          total: teams.length
        },
        players: {
          created: playerResult.created,
          updated: playerResult.updated,
          total: rosters.length
        },
        games: {
          created: gameResult.created,
          total: scores?.length || 0
        },
        stats: {
          processed: gameResult.statsProcessed
        }
      }
    });

  } catch (error) {
    console.error('❌ Ingestion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during ingestion',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};