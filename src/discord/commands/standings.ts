import { query } from '../../config/database';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generateScoutingReport } from '../../services/aiStorylineService';
import { splitMessage } from '../bot';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id), 1) as current_season,
      COALESCE((SELECT MAX(g.week)   FROM games g WHERE g.league_id = l.id), 1) as current_week
     FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

export const data = new SlashCommandBuilder()
  .setName('standings')
  .setDescription('Get the current league standings');

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);

    if (!league) {
      await interaction.editReply('❌ No league connected.');
      return;
    }

    const result = await query(
      `SELECT
        t.name, t.abbreviation,
        t.wins, t.losses,
        t.overall_rating,
        u.username as owner,
        CASE
          WHEN (t.wins + t.losses) = 0 THEN 0
          ELSE ROUND(
            t.wins::decimal / (t.wins + t.losses) * 100, 1
          )
        END as win_pct
       FROM teams t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.league_id = $1
       ORDER BY t.wins DESC, win_pct DESC`,
      [league.id]
    );

    if (result.rows.length === 0) {
      await interaction.editReply('No teams found in your league.');
      return;
    }

    let standings = `📊 **${league.name} STANDINGS**\n`;
    standings += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    standings += `Season ${league.current_season} | Week ${league.current_week}\n\n`;

    result.rows.forEach((team: any, index: number) => {
      const medal =
        index === 0 ? '🥇' :
        index === 1 ? '🥈' :
        index === 2 ? '🥉' :
        `${index + 1}.`;

      standings += `${medal} **${team.name}** (${team.abbreviation})\n`;
      standings += `   ${team.wins}-${team.losses} | OVR: ${team.overall_rating} | Owner: ${team.owner}\n\n`;
    });

    standings += `\n*Powered by AccessGrantedSportz*`;

    await interaction.editReply(standings);

  } catch (error) {
    console.error('Standings command error:', error);
    await interaction.editReply('❌ Error fetching standings.');
  }
};