import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction
} from 'discord.js';
import { query } from '../../config/database';
import { generateTradeAdvice } from '../../services/aiStorylineService';
import { COLORS, createEmbed, createTradeEmbed, getDevTraitLabel } from '../../config/brand';

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

const findPlayer = async (
  input:    string,
  leagueId: string
): Promise<any | null> => {
  const isUUID = input.length === 36 && input.includes('-');
  const result = await query(
    `SELECT
      p.id, p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.dev_trait, p.age, p.speed,
      p.team_id, p.portrait_url,
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
    [leagueId, input]
  );
  return result.rows[0] || null;
};

const autocompleteSearch = async (
  focused:  string,
  leagueId: string
) => {
  const result = await query(
    `SELECT p.id, p.first_name, p.last_name, p.position, t.abbreviation
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.league_id = $1
     AND LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
     ORDER BY p.overall_rating DESC
     LIMIT 25`,
    [leagueId, `%${focused}%`]
  );
  return result.rows.map((p: any) => ({
    name:  `${p.first_name} ${p.last_name} — ${p.position} | ${p.abbreviation || 'FA'}`,
    value: p.id
  }));
};

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('Trade analysis with full roster context')
  .addStringOption(option =>
    option
      .setName('offering')
      .setDescription('Player you are offering (supports autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option
      .setName('requesting')
      .setDescription('Player you want in return (supports autocomplete)')
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
    const options = await autocompleteSearch(focused, league.id);
    await interaction.respond(options);
  } catch { await interaction.respond([]); }
};

export const execute = async (
  interaction: ChatInputCommandInteraction
) => {
  try {
    await interaction.deferReply();
  } catch { return; }

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

    const offeringInput   = interaction.options.getString('offering',   true);
    const requestingInput = interaction.options.getString('requesting', true);

    const [offered, requested] = await Promise.all([
      findPlayer(offeringInput,   league.id),
      findPlayer(requestingInput, league.id)
    ]);

    if (!offered) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No player matching "${offeringInput}" found.\n` +
            `Try the autocomplete dropdown for best results.`
          )]
      });
      return;
    }
    if (!requested) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No player matching "${requestingInput}" found.\n` +
            `Try the autocomplete dropdown for best results.`
          )]
      });
      return;
    }

    // Loading state
    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('Trade Advisor  ·  Analyzing')
        .setDescription(
          `${offered.first_name} ${offered.last_name}  ↔  ` +
          `${requested.first_name} ${requested.last_name}\n\n` +
          `Evaluating rosters and trade value...`
        )]
    });

    const advice = await generateTradeAdvice(
      [offered.id],
      [requested.id],
      league.id,
      league.current_season
    );

    const offeredValue   = parseFloat(offered.trade_value   || '0');
    const requestedValue = parseFloat(requested.trade_value || '0');
    const diff           = Math.abs(offeredValue - requestedValue);

    const profileUrl1 = `https://accessgrantedsportz.com/player/${offered.id}`;
    const profileUrl2 = `https://accessgrantedsportz.com/player/${requested.id}`;

    const embed = createTradeEmbed(diff)
      .setTitle('Trade Analysis  ·  AccessGrantedSportz')
      .setDescription(
        `${advice.verdict}  ·  ` +
        `Gap: ${diff.toFixed(1)} TVS  ·  ` +
        `Advantage: ${advice.winner}`
      )
      .addFields(
        {
          name:   'You Offer',
          value:
            `[${offered.first_name} ${offered.last_name}](${profileUrl1})\n` +
            `${offered.position}  ·  ${offered.team_abbr || 'FA'} ` +
            `(${offered.wins || 0}-${offered.losses || 0})\n` +
            `OVR: ${offered.overall_rating}  ·  ` +
            `Age: ${offered.age}  ·  ` +
            `Spd: ${offered.speed}\n` +
            `${getDevTraitLabel(offered.dev_trait)}\n` +
            `TVS: ${offeredValue.toFixed(1)}`,
          inline: true
        },
        {
          name:   'You Receive',
          value:
            `[${requested.first_name} ${requested.last_name}](${profileUrl2})\n` +
            `${requested.position}  ·  ${requested.team_abbr || 'FA'} ` +
            `(${requested.wins || 0}-${requested.losses || 0})\n` +
            `OVR: ${requested.overall_rating}  ·  ` +
            `Age: ${requested.age}  ·  ` +
            `Spd: ${requested.speed}\n` +
            `${getDevTraitLabel(requested.dev_trait)}\n` +
            `TVS: ${requestedValue.toFixed(1)}`,
          inline: true
        },
        {
          name:   'Trade Advisor',
          value:  advice.advice.slice(0, 1024),
          inline: false
        }
      )
      .setFooter({
        text: 'TVS — Trade Value Score  ·  AccessGrantedSportz'
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Overflow
    if (advice.advice.length > 1024) {
      await interaction.followUp({
        embeds: [createEmbed(COLORS.NAVY)
          .setDescription(advice.advice.slice(1024, 4096))
          .setFooter({ text: 'AccessGrantedSportz' })]
      });
    }

  } catch (error) {
    console.error('Tradecheck error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Error')
          .setDescription('Error analyzing trade. Please try again.')]
      });
    } catch { /* ignore */ }
  }
};