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
  getPositionalScarcity
} from '../../services/tradeValueService';
import { getDraftPickValue } from '../../services/draftPickService';
import { COLORS, createEmbed, getDevTraitLabel } from '../../config/brand';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g
                WHERE g.league_id = l.id), 1) as current_season
     FROM leagues l WHERE l.discord_guild_id = $1 LIMIT 1`,
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
    `SELECT p.*, t.name as team_name, t.abbreviation as team_abbr,
      t.wins, t.losses
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.league_id = $1
     AND ${isUUID
       ? 'p.id = $2'
       : `LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')`
     }
     ORDER BY p.overall_rating DESC LIMIT 1`,
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
     ORDER BY p.overall_rating DESC LIMIT 25`,
    [leagueId, `%${focused}%`]
  );
  return result.rows.map((p: any) => ({
    name:  `${p.first_name} ${p.last_name} — ${p.position} | ${p.abbreviation || 'FA'}`,
    value: p.id
  }));
};

// Round number only — no year tracking yet
const parsePicks = (pickString: string | null): number[] => {
  if (!pickString) return [];
  return pickString
    .split(',')
    .map(s => parseInt(s.trim().replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n) && n >= 1 && n <= 7);
};

const roundLabel = (r: number): string =>
  r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('Trade analysis — supports multiple players and draft picks')
  .addStringOption(o => o
    .setName('offering1')
    .setDescription('Player you are offering (required)')
    .setRequired(true)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('requesting1')
    .setDescription('Player you want in return (required)')
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
    .setDescription('Picks you are offering — e.g. "1,2" for 1st and 2nd round')
    .setRequired(false)
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
    .setDescription('Picks you want in return — e.g. "1,3" for 1st and 3rd round')
    .setRequired(false)
  );

export const autocomplete = async (
  interaction: AutocompleteInteraction
): Promise<void> => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) { await interaction.respond([]); return; }
  const focused = interaction.options.getFocused().toLowerCase();
  if (focused.length < 2) { await interaction.respond([]); return; }
  try {
    await interaction.respond(await autocompleteSearch(focused, league.id));
  } catch {
    await interaction.respond([]);
  }
};

export const execute = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
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

    const [offeredRaw, requestedRaw] = await Promise.all([
      Promise.all(offeringInputs.map(i => findPlayer(i, league.id))),
      Promise.all(requestingInputs.map(i => findPlayer(i, league.id)))
    ]);

    const validOffered   = offeredRaw.filter(Boolean);
    const validRequested = requestedRaw.filter(Boolean);

    if (validOffered.length === 0 && offeringPickRounds.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('No Valid Players Found')
          .setDescription('Could not find any offering players. Try autocomplete.')]
      });
      return;
    }
    if (validRequested.length === 0 && requestingPickRounds.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('No Valid Players Found')
          .setDescription('Could not find any requesting players. Try autocomplete.')]
      });
      return;
    }

    // Loading
    const offerNames = [
      ...validOffered.map((p: any) => `${p.first_name} ${p.last_name}`),
      ...offeringPickRounds.map(r => `${roundLabel(r)} Round Pick`)
    ].join(', ');

    const requestNames = [
      ...validRequested.map((p: any) => `${p.first_name} ${p.last_name}`),
      ...requestingPickRounds.map(r => `${roundLabel(r)} Round Pick`)
    ].join(', ');

    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle('Trade Advisor  ·  Analyzing')
        .setDescription(
          `**Offering:**  ${offerNames}\n\n` +
          `**Requesting:**  ${requestNames}\n\n` +
          `Calculating asset values...`
        )]
    });

    // Enrich players with fresh AV and scarcity
    const enrichPlayer = async (p: any) => {
      const [avResult, scarcity] = await Promise.all([
        calculateTradeValue(p.id, league.id, league.current_season),
        getPositionalScarcity(p.id, league.id)
      ]);
      return { ...p, av: avResult.total_value, scarcity };
    };

    const [enrichedOffered, enrichedRequested] = await Promise.all([
      Promise.all(validOffered.map(enrichPlayer)),
      Promise.all(validRequested.map(enrichPlayer))
    ]);

    // Pick AV — 2 args only
    const offeringPicksAV = offeringPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );
    const requestingPicksAV = requestingPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );

    const offeredPlayersAV   = enrichedOffered.reduce(
      (sum: number, p: any) => sum + p.av, 0
    );
    const requestedPlayersAV = enrichedRequested.reduce(
      (sum: number, p: any) => sum + p.av, 0
    );

    const totalOfferedAV   = offeredPlayersAV   + offeringPicksAV;
    const totalRequestedAV = requestedPlayersAV + requestingPicksAV;
    const avDiff           = Math.abs(totalOfferedAV - totalRequestedAV);

    const winnerTeam = totalOfferedAV < totalRequestedAV
      ? (enrichedOffered[0]?.team_name   || 'Offering team')
      : (enrichedRequested[0]?.team_name || 'Requesting team');

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

    const formatSide = (
      players:    any[],
      pickRounds: number[]
    ): string => {
      const lines: string[] = [];

      players.forEach((p: any) => {
        lines.push(
          `**[${p.first_name} ${p.last_name}]` +
          `(https://accessgrantedsportz.com/player/${p.id})**\n` +
          `${p.position}  ·  ${p.team_abbr || 'FA'}\n` +
          `OVR ${p.overall_rating}  ·  Age ${p.age}  ·  Spd ${p.speed}\n` +
          `${getDevTraitLabel(p.dev_trait)}\n` +
          `AV  **${p.av.toFixed(0)}**`
        );
      });

      pickRounds.forEach(r => {
        const av = getDraftPickValue(r, null);
        lines.push(
          `**${roundLabel(r)} Round Pick**\n` +
          `AV  **${av}**  ·  Generic slot value`
        );
      });

      return lines.join('\n\n') || 'None';
    };

    const mainEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Analysis  ·  ${league.name}`)
      .setDescription(
        `**${verdict}**  ·  AV Gap: **${avDiff.toFixed(0)}**  ·  ` +
        `**${winnerTeam}** has the advantage`
      )
      .addFields(
        {
          name:   'Offering Side',
          value:  formatSide(
            enrichedOffered, offeringPickRounds
          ).slice(0, 1024),
          inline: true
        },
        {
          name:   'Requesting Side',
          value:  formatSide(
            enrichedRequested, requestingPickRounds
          ).slice(0, 1024),
          inline: true
        },
        {
          name:   'AV Summary',
          value:
            `Offering total    **${totalOfferedAV.toFixed(0)} AV**` +
            `${offeringPicksAV > 0
              ? ` (players: ${offeredPlayersAV.toFixed(0)} + picks: ${offeringPicksAV})`
              : ''}\n` +
            `Requesting total  **${totalRequestedAV.toFixed(0)} AV**` +
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

    // Trade advisor
    const advice = await generateTradeAdvice(
      enrichedOffered.map((p: any)   => p.id),
      enrichedRequested.map((p: any) => p.id),
      league.id,
      league.current_season
    );

    await interaction.followUp({
      embeds: [new EmbedBuilder()
        .setColor(verdictColor as any)
        .setTitle('Trade Advisor')
        .setDescription(advice.advice.slice(0, 4096))
        .setFooter({ text: 'AccessGrantedSportz  ·  Access Granted. Game On.' })]
    });

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