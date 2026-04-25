import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder
} from 'discord.js';
import { query } from '../../config/database';
import { generateTradeAdvice } from '../../services/aiStorylineService';
import {
  calculateTradeValue,
  getMacroPosition,
  getPlayerTrajectory,
  getPositionalScarcity
} from '../../services/tradeValueService';
import { getDraftPickValue, getPickLabel } from '../../services/draftPickService';
import { COLORS, createEmbed, getDevTraitLabel } from '../../config/brand';

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
  if (!input) return null;
  const isUUID = input.length === 36 && input.includes('-');
  const result = await query(
    `SELECT
      p.id, p.first_name, p.last_name,
      p.position, p.overall_rating,
      p.dev_trait, p.age, p.speed,
      p.team_id, p.portrait_url, p.years_pro,
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

const autocompleteSearch = async (focused: string, leagueId: string) => {
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

// =============================================
// PARSE PICK STRING
// Accepts: "1,2,3" or "1st,2nd" or "1st round,2nd round"
// Returns array of round numbers
// =============================================
const parsePicks = (pickString: string | null): number[] => {
  if (!pickString) return [];
  return pickString
    .split(',')
    .map(s => s.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean)
    .map(Number)
    .filter(n => n >= 1 && n <= 7);
};

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('Trade analysis — supports multiple players and draft picks')
  // ---- OFFERING SIDE ----
  .addStringOption(o => o
    .setName('offering1')
    .setDescription('Player you are offering (required)')
    .setRequired(true)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering2')
    .setDescription('Second player you are offering (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering3')
    .setDescription('Third player you are offering (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering_picks')
    .setDescription('Draft picks you are offering — e.g. "1,2,3" for 1st, 2nd, 3rd round')
    .setRequired(false)
  )
  // ---- REQUESTING SIDE ----
  .addStringOption(o => o
    .setName('requesting1')
    .setDescription('Player you want in return (required)')
    .setRequired(true)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('requesting2')
    .setDescription('Second player you want in return (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('requesting3')
    .setDescription('Third player you want in return (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('requesting_picks')
    .setDescription('Draft picks you want in return — e.g. "1,2" for 1st and 2nd round')
    .setRequired(false)
  );

export const autocomplete = async (
  interaction: AutocompleteInteraction
): Promise<void> => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) { await interaction.respond([]); return; }

  const focused = interaction.options.getFocused().toLowerCase();
  if (!focused || focused.length < 2) { await interaction.respond([]); return; }

  try {
    await interaction.respond(
      await autocompleteSearch(focused, league.id)
    );
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

    // Collect all inputs
    const offeringInputs = [
      interaction.options.getString('offering1'),
      interaction.options.getString('offering2'),
      interaction.options.getString('offering3')
    ].filter(Boolean) as string[];

    const requestingInputs = [
      interaction.options.getString('requesting1'),
      interaction.options.getString('requesting2'),
      interaction.options.getString('requesting3')
    ].filter(Boolean) as string[];

    const offeringPickRounds   = parsePicks(
      interaction.options.getString('offering_picks')
    );
    const requestingPickRounds = parsePicks(
      interaction.options.getString('requesting_picks')
    );

    // Resolve all players
    const [offeredPlayers, requestedPlayers] = await Promise.all([
      Promise.all(offeringInputs.map(i => findPlayer(i, league.id))),
      Promise.all(requestingInputs.map(i => findPlayer(i, league.id)))
    ]);

    // Filter nulls and check minimums
    const validOffered   = offeredPlayers.filter(Boolean);
    const validRequested = requestedPlayers.filter(Boolean);

    if (validOffered.length === 0 && offeringPickRounds.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('No Valid Players Found')
          .setDescription('Could not find any of the offering players. Try autocomplete.')]
      });
      return;
    }
    if (validRequested.length === 0 && requestingPickRounds.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('No Valid Players Found')
          .setDescription('Could not find any of the requesting players. Try autocomplete.')]
      });
      return;
    }

    // Loading state
    const offerSummary = [
      ...validOffered.map((p: any) =>
        `${p.first_name} ${p.last_name}`
      ),
      ...offeringPickRounds.map(r => `${r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`} Round Pick`)
    ].join(', ');

    const requestSummary = [
      ...validRequested.map((p: any) =>
        `${p.first_name} ${p.last_name}`
      ),
      ...requestingPickRounds.map(r => `${r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`} Round Pick`)
    ].join(', ');

    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('Trade Advisor  ·  Analyzing')
        .setDescription(
          `**Offering:**  ${offerSummary}\n\n` +
          `**Requesting:**  ${requestSummary}\n\n` +
          `Calculating asset values...`
        )]
    });

    // Calculate AV for all players
    const enrichPlayer = async (p: any) => {
      const [av, scarcity] = await Promise.all([
        calculateTradeValue(p.id, league.id, league.current_season),
        getPositionalScarcity(p.id, league.id)
      ]);
      return { ...p, av: av.total_value, scarcity };
    };

    const [enrichedOffered, enrichedRequested] = await Promise.all([
      Promise.all(validOffered.map(enrichPlayer)),
      Promise.all(validRequested.map(enrichPlayer))
    ]);

    // Calculate pick values
    const offeringPicksAV = offeringPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );
    const requestingPicksAV = requestingPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );

    // Total AV each side
    const offeredPlayersAV   = enrichedOffered.reduce(
      (sum: number, p: any) => sum + p.av, 0
    );
    const requestedPlayersAV = enrichedRequested.reduce(
      (sum: number, p: any) => sum + p.av, 0
    );

    const totalOfferedAV   = offeredPlayersAV   + offeringPicksAV;
    const totalRequestedAV = requestedPlayersAV + requestingPicksAV;
    const avDiff           = Math.abs(totalOfferedAV - totalRequestedAV);
    const avWinnerIsOffered = totalOfferedAV < totalRequestedAV;

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
      enrichedOffered.map((p: any) => p.id),
      enrichedRequested.map((p: any) => p.id),
      league.id,
      league.current_season
    );

    // =============================================
    // FORMAT SIDE SUMMARY
    // =============================================
    const formatSide = (
      players:    any[],
      pickRounds: number[],
      label:      string
    ): string => {
      const lines: string[] = [];

      players.forEach((p: any) => {
        const profileUrl = `https://accessgrantedsportz.com/player/${p.id}`;
        const macro      = getMacroPosition(p.position);
        const traj       = getPlayerTrajectory(p.age).split(' — ')[0];
        lines.push(
          `**[${p.first_name} ${p.last_name}](${profileUrl})**\n` +
          `${p.position}  ·  ${p.team_abbr || 'FA'}` +
          `${p.team_abbr ? `  (${p.wins || 0}-${p.losses || 0})` : ''}\n` +
          `OVR ${p.overall_rating}  ·  Age ${p.age}  ·  Spd ${p.speed}\n` +
          `${getDevTraitLabel(p.dev_trait)}  ·  ${traj}\n` +
          `AV  **${p.av.toFixed(0)}**  ·  ` +
          `#${p.scarcity.position_rank}/${p.scarcity.position_total} ${macro}\n` +
          `${p.scarcity.scarcity_label}`
        );
      });

      pickRounds.forEach(r => {
        const roundLabel =
          r === 1 ? '1st' : r === 2 ? '2nd' :
          r === 3 ? '3rd' : `${r}th`;
        const av = getDraftPickValue(r, null);
        lines.push(
          `**${roundLabel} Round Pick**\n` +
          `AV  **${av}**  ·  Generic slot value`
        );
      });

      return lines.join('\n\n') || 'None';
    };

    // =============================================
    // BUILD EMBEDS
    // =============================================
    const winnerTeam = avWinnerIsOffered
      ? (enrichedOffered[0]?.team_name || 'Offering team')
      : (enrichedRequested[0]?.team_name || 'Requesting team');

    const mainEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Analysis  ·  ${league.name}`)
      .setDescription(
        `**${verdict}**` +
        `  ·  AV Gap: **${avDiff.toFixed(0)}**` +
        `  ·  **${winnerTeam}** has the advantage`
      )
      .addFields(
        {
          name:   `Offering Side`,
          value:  formatSide(
            enrichedOffered, offeringPickRounds, 'Offering'
          ).slice(0, 1024),
          inline: true
        },
        {
          name:   `Requesting Side`,
          value:  formatSide(
            enrichedRequested, requestingPickRounds, 'Requesting'
          ).slice(0, 1024),
          inline: true
        },
        {
          name:   'AV Summary',
          value:
            `Offering side total  **${totalOfferedAV.toFixed(0)} AV**` +
            `${offeringPicksAV > 0
              ? ` (players: ${offeredPlayersAV.toFixed(0)} + picks: ${offeringPicksAV})`
              : ''}\n` +
            `Requesting side total  **${totalRequestedAV.toFixed(0)} AV**` +
            `${requestingPicksAV > 0
              ? ` (players: ${requestedPlayersAV.toFixed(0)} + picks: ${requestingPicksAV})`
              : ''}\n` +
            `Gap  **${avDiff.toFixed(0)} AV** favoring **${winnerTeam}**`,
          inline: false
        }
      )
      .setFooter({
        text:
          'AV — Asset Value  ·  ' +
          'Accounts for overall, age, dev trait, speed, and positional scarcity  ·  ' +
          'AccessGrantedSportz'
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [mainEmbed] });

    // Trade advisor follow-up
    const adviceEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle('Trade Advisor')
      .setDescription(advice.advice.slice(0, 4096))
      .setFooter({
        text: 'AccessGrantedSportz  ·  Access Granted. Game On.'
      });

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