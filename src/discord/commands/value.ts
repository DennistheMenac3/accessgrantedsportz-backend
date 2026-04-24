import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction
} from 'discord.js';
import { query } from '../../config/database';
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
  .setName('value')
  .setDescription('Get a player trade value score')
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

    const input = interaction.options.getString('player', true);

    // UUID from autocomplete or fuzzy name search
    const isUUID = input.length === 36 && input.includes('-');
    const result = await query(
      `SELECT
        p.id, p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.dev_trait, p.speed,
        p.years_pro, p.portrait_url,
        p.contract_salary, p.contract_years,
        t.name         as team_name,
        t.abbreviation as team_abbr,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0) as trade_value,
        tvh.calculated_at
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
       ORDER BY tvh.calculated_at DESC
       LIMIT 10`,
      [league.id, input]
    );

    if (result.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No players matching "${input}" found.\n` +
            `Try using the autocomplete dropdown for best results.`
          )]
      });
      return;
    }

    // Multiple results — show list
    if (result.rows.length > 1 && !isUUID) {
      const fields = result.rows.map((p: any, i: number) => ({
        name:  `${i + 1}. ${p.first_name} ${p.last_name}`,
        value:
          `${p.position} | ${p.team_abbr || 'FA'} ` +
          `(${p.wins || 0}-${p.losses || 0}) | ` +
          `OVR: ${p.overall_rating} | ` +
          `AV: ${parseFloat(p.trade_value).toFixed(1)}`,
        inline: false
      }));

      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle('Multiple Players Found')
          .setDescription('Use the autocomplete dropdown to select the exact player.')
          .addFields(fields)
          .setFooter({ text: 'AccessGrantedSportz  ·  Access Granted. Game On.' })]
      });
      return;
    }

    const player     = result.rows[0];
    const tradeValue = parseFloat(player.trade_value);
    const devLabel   = getDevTraitLabel(player.dev_trait);
    const devIcon    = getDevTraitIcon(player.dev_trait);
    const profileUrl = `https://accessgrantedsportz.com/player/${player.id}`;

    const valueColor =
      tradeValue >= 200 ? COLORS.GOLD   :
      tradeValue >= 100 ? COLORS.ORANGE :
      COLORS.NAVY;

    const valueTier =
      tradeValue >= 200 ? 'ELITE'        :
      tradeValue >= 150 ? 'FRANCHISE'    :
      tradeValue >= 100 ? 'PREMIUM'      :
      tradeValue >= 50  ? 'SOLID STARTER':
      'DEPTH';

    const embed = createEmbed(valueColor)
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
        `${player.team_abbr ? `  (${player.wins || 0}-${player.losses || 0})` : ''}`
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
            `AV   ${tradeValue.toFixed(1)}\n` +
            `Tier   ${valueTier}`,
          inline: true
        }
      );

    if (player.portrait_url) embed.setThumbnail(player.portrait_url);

    if (player.contract_salary) {
      embed.addFields({
        name:   'Contract',
        value:
          `Salary  $${(player.contract_salary / 1000000).toFixed(2)}M\n` +
          `Years    ${player.contract_years || '—'}`,
        inline: true
      });
    }

    embed
      .setFooter({
        text:
          'AV — Asset Value  ·  ' +
          'ELITE 200+  ·  FRANCHISE 150+  ·  PREMIUM 100+  ·  ' +
          'SOLID 50+  ·  BENCHWARMER <50  ·  AccessGrantedSportz'
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Value error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('Error')
        .setDescription('Error fetching trade value. Please try again.')]
    });
  }
};