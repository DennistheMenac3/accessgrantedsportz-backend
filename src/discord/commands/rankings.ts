import {
  SlashCommandBuilder,
  ChatInputCommandInteraction
} from 'discord.js';
import { generatePowerRankings } from '../../services/aiStorylineService';
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
  .setName('rankings')
  .setDescription('Get the latest power rankings')
  .addStringOption(option =>
    option
      .setName('style')
      .setDescription('Choose ranking style')
      .setRequired(false)
      .addChoices(
        { name: 'The Hot Seat',    value: 'stephen_a' },
        { name: 'The Power Report', value: 'standard'  }
      )
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
          .setTitle('No League Connected')
          .setDescription(
            'No league is connected to this server.\n' +
            'Ask your commissioner to set up AccessGrantedSportz.'
          )]
      });
      return;
    }

    const style     = (interaction.options.getString('style') || 'stephen_a') as 'standard' | 'stephen_a';
    const isHotSeat = style === 'stephen_a';
    const title     = isHotSeat ? 'The Hot Seat' : 'The Power Report';
    const color     = isHotSeat ? COLORS.ORANGE  : COLORS.NAVY;

    await interaction.editReply({
      embeds: [createEmbed(color)
        .setTitle(`${title}  ·  Generating`)
        .setDescription('Analyzing league data...')]
    });

    const result = await generatePowerRankings(
      league.id,
      league.current_season,
      league.current_week,
      style
    );

    const rankingsText = result.rankings;
    const chunks: string[] = [];
    let current = '';

    rankingsText.split('\n').forEach((line: string) => {
      if ((current + line).length > 1000) {
        chunks.push(current);
        current = line + '\n';
      } else {
        current += line + '\n';
      }
    });
    if (current) chunks.push(current);

    const mainEmbed = createEmbed(color)
      .setTitle(`${title}  ·  ${league.name}`)
      .setDescription(`Season ${league.current_season}  ·  Week ${league.current_week}`)
      .addFields(
        chunks.slice(0, 4).map((chunk, i) => ({
          name:   i === 0 ? 'Rankings' : '\u200b',
          value:  chunk.slice(0, 1024),
          inline: false
        }))
      )
      .setFooter({ text: 'AccessGrantedSportz  ·  Access Granted. Game On.' })
      .setTimestamp();

    await interaction.editReply({ embeds: [mainEmbed] });

    for (let i = 4; i < chunks.length; i++) {
      await interaction.followUp({
        embeds: [createEmbed(color)
          .setDescription(chunks[i].slice(0, 4096))
          .setFooter({ text: 'AccessGrantedSportz' })]
      });
    }

  } catch (error) {
    console.error('Rankings command error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('Error')
        .setDescription('Error generating rankings. Please try again.')]
    });
  }
};