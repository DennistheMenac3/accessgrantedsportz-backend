import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { generateScoutingReport } from '../../services/aiStorylineService';
import { COLORS, createEmbed, getDevTraitIcon, getDevTraitLabel } from '../../config/brand';

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
  .setDescription('Get a War Room scouting report on a player')
  .addStringOption(option =>
    option
      .setName('player')
      .setDescription('Player name (supports autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  );

export const autocomplete = async (
  interaction: AutocompleteInteraction
): Promise<void> => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) { await interaction.respond([]); return; }

  const focused = interaction.options.getFocused().toLowerCase();
  if (!focused || focused.length < 2) { await interaction.respond([]); return; }

  try {
    const result = await query(
      `SELECT p.id, p.first_name, p.last_name, p.position, t.abbreviation
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       WHERE p.league_id = $1
       AND LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
       ORDER BY p.overall_rating DESC
       LIMIT 25`,
      [league.id, `%${focused}%`]
    );
    await interaction.respond(
      result.rows.map((p: any) => ({
        name:  `${p.first_name} ${p.last_name} — ${p.position} | ${p.abbreviation || 'FA'}`,
        value: p.id
      }))
    );
  } catch { await interaction.respond([]); }
};

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
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    const input  = interaction.options.getString('player', true);
    const isUUID = input.length === 36 && input.includes('-');

    const playerResult = await query(
      `SELECT
        p.id, p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.dev_trait, p.speed,
        p.years_pro, p.portrait_url,
        p.contract_salary, p.contract_years,
        t.name         as team_name,
        t.abbreviation as team_abbr,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0) as trade_value
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id  = p.id
         AND tvh.league_id = p.league_id
       WHERE p.league_id = $1
       AND ${isUUID
         ? 'p.id = $2'
         : `LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')`
       }
       ORDER BY tvh.calculated_at DESC, p.overall_rating DESC
       LIMIT 1`,
      [league.id, input]
    );

    if (playerResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No player matching "${input}" found.\n` +
            `Try the autocomplete dropdown for best results.`
          )]
      });
      return;
    }

    const player     = playerResult.rows[0];
    const devLabel   = getDevTraitLabel(player.dev_trait);
    const devIcon    = getDevTraitIcon(player.dev_trait);
    const profileUrl = `https://accessgrantedsportz.com/player/${player.id}`;
    const tradeValue = parseFloat(player.trade_value);

    // Loading state
    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setAuthor({ name: devLabel, iconURL: devIcon })
        .setTitle(
          `${player.first_name} ${player.last_name}  ·  ` +
          `${player.position}  ·  ` +
          `${player.team_abbr || 'FA'}  ·  ` +
          `${player.overall_rating} OVR`
        )
        .setURL(profileUrl)
        .setDescription('Generating War Room report...')
        .setThumbnail(player.portrait_url || null)]
    });

    const report = await generateScoutingReport(
      league.id,
      player.id,
      league.current_season
    );

    const reportEmbed = createEmbed(COLORS.NAVY)
      .setAuthor({ name: devLabel, iconURL: devIcon })
      .setTitle(
        `${player.first_name} ${player.last_name}  ·  ` +
        `${player.position}  ·  ` +
        `${player.team_abbr || 'FA'}  ·  ` +
        `${player.overall_rating} OVR`
      )
      .setURL(profileUrl)
      .setDescription(
        `${player.team_name || 'Free Agent'}` +
        `${player.team_abbr
          ? `  (${player.wins || 0}-${player.losses || 0})`
          : ''}`
      )
      .addFields(
        {
          name:   'Ratings',
          value:
            `Overall        ${player.overall_rating || '—'}\n` +
            `Speed           ${player.speed         || '—'}\n` +
            `Age              ${player.age          || '—'}\n` +
            `Experience    ${player.years_pro ?? '—'} yrs`,
          inline: true
        },
        {
          name:   'Trade Value',
          value:
            `TVS   ${tradeValue.toFixed(1)}\n` +
            `[View Profile](${profileUrl})`,
          inline: true
        },
        {
          name:   'War Room Report',
          value:  report.slice(0, 1024),
          inline: false
        }
      )
      .setFooter({
        text: 'TVS — Trade Value Score  ·  AccessGrantedSportz'
      })
      .setTimestamp();

    if (player.portrait_url) reportEmbed.setThumbnail(player.portrait_url);

    await interaction.editReply({ embeds: [reportEmbed] });

    // Overflow
    if (report.length > 1024) {
      const chunks: string[] = [];
      let current = '';
      report.slice(1024).split('\n').forEach((line: string) => {
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
          embeds: [createEmbed(COLORS.NAVY)
            .setDescription(chunk)
            .setFooter({ text: 'AccessGrantedSportz' })]
        });
      }
    }

  } catch (error) {
    console.error('Scout error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('Error')
        .setDescription('Error generating scouting report. Please try again.')]
    });
  }
};