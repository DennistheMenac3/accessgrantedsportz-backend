import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder
} from 'discord.js';
import { query } from '../../config/database';
import { generateTradeAdvice } from '../../services/aiStorylineService';
import { calculateTradeValue, getMacroPosition, getPlayerTrajectory, getPositionalScarcity } from '../../services/tradeValueService';
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
      p.years_pro,
      t.name         as team_name,
      t.abbreviation as team_abbr,
      t.wins, t.losses
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.league_id = $1
     AND ${isUUID
       ? 'p.id = $2'
       : `LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')`
     }
     ORDER BY p.overall_rating DESC
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
  try { await interaction.deferReply(); } catch { return; }

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
            `Try the autocomplete dropdown.`
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
            `Try the autocomplete dropdown.`
          )]
      });
      return;
    }

    // Loading state
    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('Trade Advisor  ·  Analyzing')
        .setDescription(
          `${offered.first_name} ${offered.last_name}` +
          `  ↔  ` +
          `${requested.first_name} ${requested.last_name}\n\n` +
          `Calculating asset values and roster context...`
        )]
    });

    // Force fresh AV calculations for both players
    const [
      offeredAV,
      requestedAV,
      offeredScarcity,
      requestedScarcity
    ] = await Promise.all([
      calculateTradeValue(offered.id,   league.id, league.current_season),
      calculateTradeValue(requested.id, league.id, league.current_season),
      getPositionalScarcity(offered.id,   league.id),
      getPositionalScarcity(requested.id, league.id)
    ]);

    offered.av   = offeredAV.total_value;
    requested.av = requestedAV.total_value;

    const avDiff      = Math.abs(offered.av - requested.av);
    const avWinner    = offered.av > requested.av ? requested : offered;
    const avLoser     = offered.av > requested.av ? offered   : requested;

    const verdict =
      avDiff <= 20  ? 'FAIR'            :
      avDiff <= 60  ? 'SLIGHT EDGE'     :
      avDiff <= 120 ? 'CLEAR ADVANTAGE' :
      avDiff <= 200 ? 'LOPSIDED'        :
      'HIGHWAY ROBBERY';

    const verdictColor =
      avDiff <= 20  ? COLORS.SUCCESS :
      avDiff <= 60  ? COLORS.GOLD    :
      avDiff <= 120 ? COLORS.ORANGE  :
      COLORS.DANGER;

    // Get AI analysis
    const advice = await generateTradeAdvice(
      [offered.id],
      [requested.id],
      league.id,
      league.current_season
    );

    const profileUrl1 = `https://accessgrantedsportz.com/player/${offered.id}`;
    const profileUrl2 = `https://accessgrantedsportz.com/player/${requested.id}`;

    const formatPlayerCard = (
      p:        any,
      av:       number,
      scarcity: any,
      label:    string,
      url:      string
    ): string => {
      const trajectory = getPlayerTrajectory(p.age);
      const macroPos   = getMacroPosition(p.position);

      return (
        `**[${p.first_name} ${p.last_name}](${url})**\n` +
        `${p.position}  ·  ${p.team_abbr || 'FA'}` +
        `${p.team_abbr ? `  (${p.wins || 0}-${p.losses || 0})` : ''}\n` +
        `\n` +
        `OVR  ${p.overall_rating}` +
        `  ·  Age  ${p.age}` +
        `  ·  Spd  ${p.speed}\n` +
        `${getDevTraitLabel(p.dev_trait)}\n` +
        `\n` +
        `AV  **${av.toFixed(0)}**\n` +
        `Rank  #${scarcity.position_rank} of ${scarcity.position_total} ${macroPos}\n` +
        `${scarcity.scarcity_label}\n` +
        `Trajectory  ${trajectory.split(' — ')[0]}`
      );
    };

    // Main embed
    const mainEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Analysis  ·  ${league.name}`)
      .setDescription(
        `**${verdict}**` +
        `  ·  AV Gap: **${avDiff.toFixed(0)}**` +
        `  ·  **${avWinner.team_name || avWinner.team_abbr}** has the advantage`
      )
      .addFields(
        {
          name:   `Offering  ·  ${offered.team_name || 'Free Agent'}`,
          value:  formatPlayerCard(
            offered, offered.av, offeredScarcity,
            'Offering', profileUrl1
          ),
          inline: true
        },
        {
          name:   `Receiving  ·  ${requested.team_name || 'Free Agent'}`,
          value:  formatPlayerCard(
            requested, requested.av, requestedScarcity,
            'Receiving', profileUrl2
          ),
          inline: true
        },
        {
          name:   'AV Breakdown',
          value:
            `${offered.first_name} ${offered.last_name}` +
            `  →  AV **${offered.av.toFixed(0)}**\n` +
            `${requested.first_name} ${requested.last_name}` +
            `  →  AV **${requested.av.toFixed(0)}**\n` +
            `Gap  **${avDiff.toFixed(0)} AV** favoring ` +
            `**${avWinner.first_name} ${avWinner.last_name}**`,
          inline: false
        }
      )
      .setFooter({
        text:
          'AV — Asset Value  ·  ' +
          'Accounts for overall, age curve, dev trait, speed, and positional scarcity  ·  ' +
          'AccessGrantedSportz'
      })
      .setTimestamp();

    // Add portraits if available
    if (offered.portrait_url) {
      mainEmbed.setThumbnail(offered.portrait_url);
    }

    await interaction.editReply({ embeds: [mainEmbed] });

    // Trade advisor analysis in follow-up embed
    const adviceEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle('Trade Advisor')
      .setDescription(advice.advice.slice(0, 4096))
      .setFooter({ text: 'AccessGrantedSportz  ·  Access Granted. Game On.' });

    await interaction.followUp({ embeds: [adviceEmbed] });

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