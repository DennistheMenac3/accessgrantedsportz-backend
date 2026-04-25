// src/discord/commands/trade.ts
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
import { calculateTradeValue } from '../../services/tradeValueService';
import { getDraftPickValue } from '../../services/draftPickService';
import { COLORS, createEmbed, getDevTraitLabel } from '../../config/brand';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*, COALESCE((SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id), 1) as current_season
     FROM leagues l WHERE l.discord_guild_id = $1 LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

const findPlayer = async (input: string, leagueId: string): Promise<any | null> => {
  if (!input) return null;
  const isUUID = input.length === 36 && input.includes('-');
  const result = await query(
    `SELECT p.*, t.name as team_name, t.abbreviation as team_abbr, u.discord_user_id as owner_discord_id
     FROM players p LEFT JOIN teams t ON t.id = p.team_id LEFT JOIN users u ON u.id = t.owner_id
     WHERE p.league_id = $1 AND ${isUUID ? 'p.id = $2' : `LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER('%' || $2 || '%')`}
     ORDER BY p.overall_rating DESC LIMIT 1`,
    [leagueId, input]
  );
  return result.rows[0] || null;
};

const autocompleteSearch = async (focused: string, leagueId: string) => {
  const result = await query(
    `SELECT p.id, p.first_name, p.last_name, p.position, t.abbreviation
     FROM players p LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.league_id = $1 AND LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($2)
     ORDER BY p.overall_rating DESC LIMIT 25`,
    [leagueId, `%${focused}%`]
  );
  return result.rows.map((p: any) => ({ name: `${p.first_name} ${p.last_name} — ${p.position} | ${p.abbreviation || 'FA'}`, value: p.id }));
};

interface ParsedPick { round: number; yearsOut: number; }

const parsePicks = (pickString: string | null, currentYear: number = 25): ParsedPick[] => {
  if (!pickString) return [];
  return pickString.split(',').map(s => {
    const cleanStr = s.trim();
    const yearRoundMatch = cleanStr.match(/(\d{2})-(\d)/);
    if (yearRoundMatch) {
      const year = parseInt(yearRoundMatch[1], 10);
      const round = parseInt(yearRoundMatch[2], 10);
      return { round, yearsOut: Math.max(0, year - currentYear) };
    }
    const match = cleanStr.match(/\d+/);
    return { round: match ? parseInt(match[0], 10) : 0, yearsOut: 0 };
  }).filter(p => p.round >= 1 && p.round <= 7);
};

const roundLabel = (r: number): string => r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;

export const data = new SlashCommandBuilder()
  .setName('trade')
  .setDescription('Propose a trade — supports multiple players and draft picks')
  .addStringOption(o => o.setName('offering1').setDescription('Player you are sending (required)').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('offering2').setDescription('Second player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('offering3').setDescription('Third player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('offering_picks').setDescription('e.g. "1,2" or "26-1"'))
  .addStringOption(o => o.setName('requesting1').setDescription('Player you want in return (required)').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('requesting2').setDescription('Second player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('requesting3').setDescription('Third player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('requesting_picks').setDescription('e.g. "1,3"'));

export const autocomplete = async (interaction: AutocompleteInteraction) => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLowerCase();
  if (focused.length < 2) return interaction.respond([]);
  try { await interaction.respond(await autocompleteSearch(focused, league.id)); } catch { await interaction.respond([]); }
};

export const execute = async (interaction: ChatInputCommandInteraction) => {
  try { await interaction.deferReply({ ephemeral: false }); } catch { return; }

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) return interaction.editReply({ content: 'No league connected.' });

    const offeringInputs = [interaction.options.getString('offering1'), interaction.options.getString('offering2'), interaction.options.getString('offering3')].filter(Boolean) as string[];
    const requestingInputs = [interaction.options.getString('requesting1'), interaction.options.getString('requesting2'), interaction.options.getString('requesting3')].filter(Boolean) as string[];

    const offeringPickRounds = parsePicks(interaction.options.getString('offering_picks'));
    const requestingPickRounds = parsePicks(interaction.options.getString('requesting_picks'));

    const [offeredRaw, requestedRaw] = await Promise.all([
      Promise.all(offeringInputs.map(i => findPlayer(i, league.id))),
      Promise.all(requestingInputs.map(i => findPlayer(i, league.id)))
    ]);

    const validOffered = offeredRaw.filter(Boolean);
    const validRequested = requestedRaw.filter(Boolean);

    if (validOffered.length === 0 && offeringPickRounds.length === 0) return interaction.editReply({ content: 'No valid offering assets.' });
    if (validRequested.length === 0 && requestingPickRounds.length === 0) return interaction.editReply({ content: 'No valid requesting assets.' });

    const proposerResult = await query(
      `SELECT t.id, t.name, t.abbreviation FROM teams t JOIN users u ON u.id = t.owner_id WHERE u.discord_user_id = $1 AND t.league_id = $2`,
      [interaction.user.id, league.id]
    );

    if (proposerResult.rows.length === 0) return interaction.editReply({ content: 'You do not own a team. Use /claim.' });
    const proposerTeam = proposerResult.rows[0];

    const wrongTeam = validOffered.find((p: any) => p.team_id !== proposerTeam.id);
    if (wrongTeam) return interaction.editReply({ content: `${wrongTeam.first_name} ${wrongTeam.last_name} does not belong to your team.` });

    const partnerTeamId = validRequested[0]?.team_id;
    if (!partnerTeamId) return interaction.editReply({ content: 'Could not determine the partner team.' });

    const partnerResult = await query(`SELECT * FROM teams WHERE id = $1`, [partnerTeamId]);
    const partnerTeam = partnerResult.rows[0];

    const enrichPlayer = async (p: any) => {
      const av = await calculateTradeValue(p.id, league.id, league.current_season);
      return { ...p, av: av.total_value };
    };

    const [enrichedOffered, enrichedRequested] = await Promise.all([
      Promise.all(validOffered.map(enrichPlayer)),
      Promise.all(validRequested.map(enrichPlayer))
    ]);

    const offeringPicksAV = offeringPickRounds.reduce((sum, p) => sum + getDraftPickValue(p.round, null, p.yearsOut), 0);
    const requestingPicksAV = requestingPickRounds.reduce((sum, p) => sum + getDraftPickValue(p.round, null, p.yearsOut), 0);

    const totalOfferedAV = enrichedOffered.reduce((sum: number, p: any) => sum + p.av, 0) + offeringPicksAV;
    const totalRequestedAV = enrichedRequested.reduce((sum: number, p: any) => sum + p.av, 0) + requestingPicksAV;

    const avDiff = Math.abs(totalOfferedAV - totalRequestedAV);
    const verdict = avDiff <= 20 ? 'FAIR' : avDiff <= 60 ? 'SLIGHT EDGE' : avDiff <= 120 ? 'CLEAR ADVANTAGE' : avDiff <= 200 ? 'LOPSIDED' : 'HIGHWAY ROBBERY';
    const verdictColor = avDiff <= 20 ? COLORS.SUCCESS : avDiff <= 60 ? COLORS.GOLD : avDiff <= 120 ? COLORS.ORANGE : COLORS.DANGER;

    const offerStr = [
      ...enrichedOffered.map((p: any) => `${p.first_name} ${p.last_name} (${p.position} | ${p.overall_rating} OVR | AV: ${p.av.toFixed(0)})`),
      ...offeringPickRounds.map(p => `${p.yearsOut > 0 ? `+${p.yearsOut} Yr ` : ''}${roundLabel(p.round)} Round Pick (AV: ${getDraftPickValue(p.round, null, p.yearsOut)})`)
    ].join('\n');

    const requestStr = [
      ...enrichedRequested.map((p: any) => `${p.first_name} ${p.last_name} (${p.position} | ${p.overall_rating} OVR | AV: ${p.av.toFixed(0)})`),
      ...requestingPickRounds.map(p => `${p.yearsOut > 0 ? `+${p.yearsOut} Yr ` : ''}${roundLabel(p.round)} Round Pick (AV: ${getDraftPickValue(p.round, null, p.yearsOut)})`)
    ].join('\n');

    const tradeId = uuidv4();
    await query(
      `INSERT INTO trades (id, league_id, proposer_team_id, partner_team_id, proposer_players, partner_players, proposer_picks, partner_picks, status, total_offered_av, total_requested_av, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [tradeId, league.id, proposerTeam.id, partnerTeamId, JSON.stringify(enrichedOffered.map((p: any) => p.id)), JSON.stringify(enrichedRequested.map((p: any) => p.id)), JSON.stringify(offeringPickRounds), JSON.stringify(requestingPickRounds), 'pending', totalOfferedAV, totalRequestedAV]
    );

    const tradeEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Proposal  ·  ${league.name}`)
      .setDescription(`**${verdict}** ·  AV Gap: **${avDiff.toFixed(0)}**\nProposed by <@${interaction.user.id}>`)
      .addFields(
        { name: `${proposerTeam.name} Sends`, value: offerStr || 'Nothing', inline: true },
        { name: `${partnerTeam?.name || 'Partner'} Sends`, value: requestStr || 'Nothing', inline: true },
        { name: 'AV Summary', value: `${proposerTeam.name} → **${totalOfferedAV.toFixed(0)} AV**\n${partnerTeam?.name || 'Partner'} → **${totalRequestedAV.toFixed(0)} AV**\nGap **${avDiff.toFixed(0)} AV**`, inline: false }
      ).setFooter({ text: `Trade ID: ${tradeId}  ·  AccessGrantedSportz` }).setTimestamp();

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`approve_trade_${tradeId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`deny_trade_${tradeId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`counter_trade_${tradeId}`).setLabel('Request Counter').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({
      embeds: [createEmbed(COLORS.SUCCESS).setTitle('Trade Proposal Submitted').setDescription(`**You send:**\n${offerStr}\n\n**You receive:**\n${requestStr}\n\nTrade ID: \`${tradeId}\``)]
    });

    const logChannel = interaction.guild?.channels.cache.find((c: any) => c.name === 'commish-log' || c.name === 'ags-trades') as any;
    if (logChannel) await logChannel.send({ embeds: [tradeEmbed], components: [buttons] });

  } catch (error) {
    console.error('Trade error:', error);
    try { await interaction.editReply({ content: 'Error submitting trade.' }); } catch {}
  }
};