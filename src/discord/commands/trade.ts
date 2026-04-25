import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { query } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';
import {
  calculateTradeValue,
  getPositionalScarcity,
  getMacroPosition,
  getPlayerTrajectory
} from '../../services/tradeValueService';
import { getDraftPickValue } from '../../services/draftPickService';
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
      p.team_id, p.years_pro,
      t.name         as team_name,
      t.abbreviation as team_abbr,
      t.wins, t.losses,
      u.discord_user_id as owner_discord_id
     FROM players p
     LEFT JOIN teams t ON t.id = p.team_id
     LEFT JOIN users u ON u.id = t.owner_id
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

const parsePicks = (pickString: string | null): number[] => {
  if (!pickString) return [];
  return pickString
    .split(',')
    .map(s => s.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean)
    .map(Number)
    .filter(n => n >= 1 && n <= 7);
};

const roundLabel = (r: number): string =>
  r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Propose a trade — supports multiple players and draft picks')
  // ---- OFFERING SIDE ----
  .addStringOption(o => o
    .setName('offering1')
    .setDescription('Player you are sending (required)')
    .setRequired(true)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering2')
    .setDescription('Second player you are sending (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering3')
    .setDescription('Third player you are sending (optional)')
    .setRequired(false)
    .setAutocomplete(true)
  )
  .addStringOption(o => o
    .setName('offering_picks')
    .setDescription('Picks you are sending — e.g. "1,2" for 1st and 2nd round')
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
    .setDescription('Picks you want in return — e.g. "1,3" for 1st and 3rd round')
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
  try { await interaction.deferReply({ ephemeral: false }); } catch { return; }

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

    // Collect inputs
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

    // Resolve players
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

    // Validate teams — proposer must own the offering players
    const proposerResult = await query(
      `SELECT t.id, t.name, t.abbreviation
       FROM teams t
       JOIN users u ON u.id = t.owner_id
       WHERE u.discord_user_id = $1
       AND t.league_id = $2`,
      [interaction.user.id, league.id]
    );

    if (proposerResult.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('No Team Found')
          .setDescription(
            'You do not own a team in this league.\n' +
            'Use /claim to claim your team first.'
          )]
      });
      return;
    }

    const proposerTeam = proposerResult.rows[0];

    // Verify all offered players belong to proposer
    const wrongTeam = validOffered.find(
      (p: any) => p.team_id !== proposerTeam.id
    );
    if (wrongTeam) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Invalid Trade')
          .setDescription(
            `${wrongTeam.first_name} ${wrongTeam.last_name} ` +
            `does not belong to your team.`
          )]
      });
      return;
    }

    // Get partner team from requested players
    const partnerTeamId = validRequested[0]?.team_id;
    if (!partnerTeamId) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Invalid Trade')
          .setDescription('Could not determine the partner team.')]
      });
      return;
    }

    const partnerResult = await query(
      `SELECT t.name, t.abbreviation,
        u.discord_user_id as owner_discord_id,
        u.username        as owner_username
       FROM teams t
       LEFT JOIN users u ON u.id = t.owner_id
       WHERE t.id = $1`,
      [partnerTeamId]
    );
    const partnerTeam = partnerResult.rows[0];

    // Calculate AV for all players
    const enrichPlayer = async (p: any) => {
      const av = await calculateTradeValue(
        p.id, league.id, league.current_season
      );
      return { ...p, av: av.total_value };
    };

    const [enrichedOffered, enrichedRequested] = await Promise.all([
      Promise.all(validOffered.map(enrichPlayer)),
      Promise.all(validRequested.map(enrichPlayer))
    ]);

    // AV totals
    const offeringPicksAV = offeringPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );
    const requestingPicksAV = requestingPickRounds.reduce(
      (sum, r) => sum + getDraftPickValue(r, null), 0
    );

    const totalOfferedAV   = enrichedOffered.reduce(
      (sum: number, p: any) => sum + p.av, 0
    ) + offeringPicksAV;

    const totalRequestedAV = enrichedRequested.reduce(
      (sum: number, p: any) => sum + p.av, 0
    ) + requestingPicksAV;

    const avDiff = Math.abs(totalOfferedAV - totalRequestedAV);

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

    // Build offer summary strings
    const offerStr = [
      ...enrichedOffered.map((p: any) =>
        `${p.first_name} ${p.last_name} (${p.position} | ` +
        `${p.overall_rating} OVR | AV: ${p.av.toFixed(0)})`
      ),
      ...offeringPickRounds.map(r =>
        `${roundLabel(r)} Round Pick (AV: ${getDraftPickValue(r, null)})`
      )
    ].join('\n');

    const requestStr = [
      ...enrichedRequested.map((p: any) =>
        `${p.first_name} ${p.last_name} (${p.position} | ` +
        `${p.overall_rating} OVR | AV: ${p.av.toFixed(0)})`
      ),
      ...requestingPickRounds.map(r =>
        `${roundLabel(r)} Round Pick (AV: ${getDraftPickValue(r, null)})`
      )
    ].join('\n');

    // Save to database
    const tradeId = uuidv4();

    await query(
      `INSERT INTO trades (
        id, league_id,
        proposer_team_id, partner_team_id,
        proposer_players, partner_players,
        proposer_picks, partner_picks,
        status, total_offered_av, total_requested_av,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        tradeId,
        league.id,
        proposerTeam.id,
        partnerTeamId,
        JSON.stringify(enrichedOffered.map((p: any) => p.id)),
        JSON.stringify(enrichedRequested.map((p: any) => p.id)),
        JSON.stringify(offeringPickRounds),
        JSON.stringify(requestingPickRounds),
        'pending',
        totalOfferedAV,
        totalRequestedAV
      ]
    );

    // =============================================
    // TRADE PROPOSAL EMBED
    // =============================================
    const tradeEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Proposal  ·  ${league.name}`)
      .setDescription(
        `**${verdict}**  ·  AV Gap: **${avDiff.toFixed(0)}**\n` +
        `Proposed by <@${interaction.user.id}> ` +
        `${partnerTeam?.owner_discord_id
          ? `→ <@${partnerTeam.owner_discord_id}>`
          : `→ ${partnerTeam?.owner_username || partnerTeam?.abbreviation || 'Partner'}`
        }`
      )
      .addFields(
        {
          name:   `${proposerTeam.name} Sends`,
          value:  offerStr || 'Nothing',
          inline: true
        },
        {
          name:   `${partnerTeam?.name || 'Partner'} Sends`,
          value:  requestStr || 'Nothing',
          inline: true
        },
        {
          name:   'AV Summary',
          value:
            `${proposerTeam.name}  →  **${totalOfferedAV.toFixed(0)} AV**\n` +
            `${partnerTeam?.name || 'Partner'}  →  **${totalRequestedAV.toFixed(0)} AV**\n` +
            `Gap  **${avDiff.toFixed(0)} AV**`,
          inline: false
        }
      )
      .setFooter({
        text:
          `Trade ID: ${tradeId}  ·  ` +
          `AV — Asset Value  ·  AccessGrantedSportz`
      })
      .setTimestamp();

    // Commissioner approval buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_trade_${tradeId}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`deny_trade_${tradeId}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`counter_trade_${tradeId}`)
          .setLabel('Request Counter')
          .setStyle(ButtonStyle.Secondary)
      );

    // Notify proposer
    await interaction.editReply({
      embeds: [createEmbed(COLORS.SUCCESS)
        .setTitle('Trade Proposal Submitted')
        .setDescription(
          `Your trade proposal has been sent for commissioner review.\n\n` +
          `**You send:**\n${offerStr}\n\n` +
          `**You receive:**\n${requestStr}\n\n` +
          `Trade ID: \`${tradeId}\``
        )]
    });

    // Post to commish-log channel
    const logChannel = interaction.guild?.channels.cache.find(
      (c: any) => c.name === 'commish-log' || c.name === 'ags-trades'
    ) as any;

    if (logChannel) {
      await logChannel.send({
        embeds:     [tradeEmbed],
        components: [buttons]
      });
    }

  } catch (error) {
    console.error('Trade error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Error')
          .setDescription('Error submitting trade. Please try again.')]
      });
    } catch { /* ignore */ }
  }
};