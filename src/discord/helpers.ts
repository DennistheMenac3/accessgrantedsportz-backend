import { query } from '../config/database';

// =============================================
// Get league connected to a Discord server
// =============================================
export const getLeagueForServer = async (
  guildId: string
): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE(
        (SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id),
        1
      ) as current_season,
      COALESCE(
        (SELECT MAX(g.week) FROM games g WHERE g.league_id = l.id),
        1
      ) as current_week
     FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};