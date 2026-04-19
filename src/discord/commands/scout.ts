import { query } from '../../config/database';
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generateScoutingReport } from '../../services/aiStorylineService';
import { COLORS, createEmbed } from '../../config/brand';

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
  .setName('scout')
  .setDescription('🔍 Get a War Room scouting report on a player')
  .addStringOption(option =>
    option
      .setName('player')
      .setDescription('Player name (first last)')
      .setRequired(true)
  );

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  await interaction.deferReply();

  try {
    const league = await getLeagueForServer(interaction.guildId!);

    if (!league) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ No League Connected')
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    const playerName = interaction.options.getString('player', true);

    // Find the player with full info
    const playerResult = await query(
      `SELECT
        p.id, p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.dev_trait, p.speed,
        t.name         as team_name,
        t.abbreviation as team_abbr,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0) as trade_value
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id = p.id
         AND tvh.league_id = p.league_id
       WHERE p.league_id = $1
       AND (
         LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
         OR LOWER(p.first_name) LIKE LOWER($2)
         OR LOWER(p.last_name)  LIKE LOWER($2)
         OR LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')
       )
       ORDER BY tvh.calculated_at DESC
       LIMIT 1`,
      [league.id, playerName]
    );

    if (playerResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Player Not Found')
          .setDescription(`Player "${playerName}" not found in your league.`)]
      });
      return;
    }

    const player = playerResult.rows[0];

    const devLabel =
      player.dev_trait === 'xfactor'   ? '⚡ XFactor'  :
      player.dev_trait === 'superstar' ? '⭐ Superstar' :
      player.dev_trait === 'star'      ? '🌟 Star'      : '📋 Normal';

    // Loading embed
    await interaction.editReply({
      embeds: [createEmbed(COLORS.GOLD)
        .setTitle('🔍 War Room | Pulling the File...')
        .setDescription(
          `Analyzing **${player.first_name} ${player.last_name}**\n` +
          `${player.position} | ${player.team_name} ` +
          `(${player.wins}-${player.losses})\n\n` +
          `Generating full scouting report... (~15 seconds)`
        )
        .addFields(
          { name: 'Overall',   value: `${player.overall_rating}`,                     inline: true },
          { name: 'Age',       value: `${player.age}`,                                inline: true },
          { name: 'Dev Trait', value: devLabel,                                       inline: true },
          { name: 'Speed',     value: `${player.speed}`,                              inline: true },
          { name: '💰 TVS',    value: `${parseFloat(player.trade_value).toFixed(1)}`, inline: true }
        )]
    });

    const report = await generateScoutingReport(
      league.id,
      player.id,
      league.current_season
    );

    // Main report embed
    const reportEmbed = createEmbed(COLORS.GOLD)
      .setTitle(
        `🔍 War Room Report | ${player.first_name} ${player.last_name}`
      )
      .setDescription(
        `${player.position} | ${player.team_name} ` +
        `(${player.wins}-${player.losses}) | ` +
        `${devLabel} | TVS: **${parseFloat(player.trade_value).toFixed(1)}**`
      )
      .addFields(
        { name: 'Overall',  value: `${player.overall_rating}`, inline: true },
        { name: 'Age',      value: `${player.age}`,            inline: true },
        { name: 'Speed',    value: `${player.speed}`,          inline: true },
        {
          name:   '📋 Scouting Report',
          value:  report.slice(0, 1024),
          inline: false
        }
      );

    await interaction.editReply({ embeds: [reportEmbed] });

    // Post overflow if report is long
    if (report.length > 1024) {
      const remaining = report.slice(1024);
      const chunks    = [];
      let current     = '';

      remaining.split('\n').forEach((line: string) => {
        if ((current + line).length > 1000) {
          chunks.push(current);
          current = line + '\n';
        } else {
          current += line + '\n';
        }
      });
      if (current) chunks.push(current);

      for (const chunk of chunks) {
        await interaction.followUp({
          embeds: [createEmbed(COLORS.GOLD)
            .setDescription(chunk)]
        });
      }
    }

  } catch (error) {
    console.error('Scout command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error generating scouting report. Please try again.')]
    });
  }
};