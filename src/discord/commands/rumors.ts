import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generateTradeRumors } from '../../services/aiStorylineService';
import { query } from '../../config/database';
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
  .setName('rumors')
  .setDescription('Get the latest Word on the Street trade rumors')
  .addIntegerOption(option =>
    option
      .setName('deadline')
      .setDescription('Weeks until trade deadline (triggers deadline report)')
      .setRequired(false)
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

    const weeksToDeadline = interaction.options.getInteger('deadline') ?? undefined;

    // Loading embed
    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('📰 Word on the Street | Gathering Intel...')
        .setDescription('League sources are talking... (~15 seconds)')]
    });

    const result = await generateTradeRumors(
      league.id,
      league.current_season,
      league.current_week,
      weeksToDeadline
    );

    // Rumors embed
    const rumorsEmbed = createEmbed(COLORS.NAVY)
      .setTitle(`📰 Word on the Street | ${league.name}`)
      .setDescription(
        `Week ${league.current_week} | Season ${league.current_season}`
      )
      .addFields({
        name:   '🔍 League Rumors',
        value:  result.rumors.slice(0, 1024),
        inline: false
      });

    await interaction.editReply({ embeds: [rumorsEmbed] });

    // Hot takes embed
    const takesEmbed = createEmbed(COLORS.ORANGE)
      .setTitle('🔥 Hot Takes | Word on the Street')
      .setDescription(result.hot_takes.slice(0, 4096));

    await interaction.followUp({ embeds: [takesEmbed] });

    // Overflow rumors if needed
    if (result.rumors.length > 1024) {
      await interaction.followUp({
        embeds: [createEmbed(COLORS.NAVY)
          .setDescription(result.rumors.slice(1024, 4096))]
      });
    }

    // Deadline report if triggered
    if (result.deadline_report) {
      const deadlineEmbed = createEmbed(COLORS.DANGER)
        .setTitle('🚨 Trade Deadline Alert | Word on the Street')
        .setDescription(result.deadline_report.slice(0, 4096));

      await interaction.followUp({ embeds: [deadlineEmbed] });
    }

  } catch (error) {
    console.error('Rumors command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('❌ Error')
        .setDescription('Error generating rumors. Please try again.')]
    });
  }
};