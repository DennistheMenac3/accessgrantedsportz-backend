// src/discord/commands/tradecheck.ts
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
import { getDraftPickValue } from '../../services/draftPickService';
import { COLORS, createEmbed, getDevTraitLabel } from '../../config/brand';

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g WHERE g.league_id = l.id), 1) as current_season
     FROM leagues l WHERE l.discord_guild_id = $1 LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

const findPlayer = async (input: string, leagueId: string): Promise<any | null> => {
  if (!input) return null;
  const isUUID = input.length === 36 && input.includes('-');
  const result = await query(
    `SELECT p.*, t.name as team_name, t.abbreviation as team_abbr, t.wins, t.losses
     FROM players p LEFT JOIN teams t ON t.id = p.team_id
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
  return result.rows.map((p: any) => ({
    name:  `${p.first_name} ${p.last_name} — ${p.position} | ${p.abbreviation || 'FA'}`,
    value: p.id
  }));
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

export const data = new SlashCommandBuilder()
  .setName('tradecheck')
  .setDescription('Trade analysis — supports multiple players and draft picks')
  .addStringOption(o => o.setName('offering1').setDescription('Player you are offering (required)').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('offering2').setDescription('Second player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('offering3').setDescription('Third player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('offering_picks').setDescription('e.g. "1,2" or "26-1, 27-2"'))
  .addStringOption(o => o.setName('requesting1').setDescription('Player you want in return (required)').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('requesting2').setDescription('Second player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('requesting3').setDescription('Third player (optional)').setAutocomplete(true))
  .addStringOption(o => o.setName('requesting_picks').setDescription('e.g. "1,3" or "26-2"'));

export const autocomplete = async (interaction: AutocompleteInteraction) => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) return interaction.respond([]);
  const focused = interaction.options.getFocused().toLowerCase();
  if (focused.length < 2) return interaction.respond([]);
  try { await interaction.respond(await autocompleteSearch(focused, league.id)); } catch { await interaction.respond([]); }
};

export const execute = async (interaction: ChatInputCommandInteraction) => {
  try { await interaction.deferReply(); } catch { return; }

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) return interaction.editReply({ content: 'No league connected.' });

    const offeringInputs = [interaction.options.getString('offering1'), interaction.options.getString('offering2'), interaction.options.getString('offering3')].filter(Boolean) as string[];
    const requestingInputs = [interaction.options.getString('requesting1'), interaction.options.getString('requesting2'), interaction.options.getString('requesting3')].filter(Boolean) as string[];

    const offeringPickRounds = parsePicks(interaction.options.getString('offering_picks'));
    const requestingPickRounds = parsePicks(interaction.options.getString('requesting_picks'));

    const [offeredPlayers, requestedPlayers] = await Promise.all([
      Promise.all(offeringInputs.map(i => findPlayer(i, league.id))),
      Promise.all(requestingInputs.map(i => findPlayer(i, league.id)))
    ]);

    const validOffered = offeredPlayers.filter(Boolean);
    const validRequested = requestedPlayers.filter(Boolean);

    if (validOffered.length === 0 && offeringPickRounds.length === 0) return interaction.editReply({ content: 'No valid offering assets found.' });
    if (validRequested.length === 0 && requestingPickRounds.length === 0) return interaction.editReply({ content: 'No valid requesting assets found.' });

    const enrichPlayer = async (p: any) => {
      const [av, scarcity] = await Promise.all([calculateTradeValue(p.id, league.id, league.current_season), getPositionalScarcity(p.id, league.id)]);
      return { ...p, av: av.total_value, scarcity };
    };

    const [enrichedOffered, enrichedRequested] = await Promise.all([
      Promise.all(validOffered.map(enrichPlayer)),
      Promise.all(validRequested.map(enrichPlayer))
    ]);

    const offeringPicksAV = offeringPickRounds.reduce((sum, p) => sum + getDraftPickValue(p.round, null, p.yearsOut), 0);
    const requestingPicksAV = requestingPickRounds.reduce((sum, p) => sum + getDraftPickValue(p.round, null, p.yearsOut), 0);

    const offeredPlayersAV = enrichedOffered.reduce((sum: number, p: any) => sum + p.av, 0);
    const requestedPlayersAV = enrichedRequested.reduce((sum: number, p: any) => sum + p.av, 0);

    const totalOfferedAV = offeredPlayersAV + offeringPicksAV;
    const totalRequestedAV = requestedPlayersAV + requestingPicksAV;
    const avDiff = Math.abs(totalOfferedAV - totalRequestedAV);
    const winnerTeam = totalOfferedAV < totalRequestedAV ? (enrichedOffered[0]?.team_name || 'Offering team') : (enrichedRequested[0]?.team_name || 'Requesting team');

    const verdict = avDiff <= 20 ? 'FAIR' : avDiff <= 60 ? 'SLIGHT EDGE' : avDiff <= 120 ? 'CLEAR ADVANTAGE' : avDiff <= 200 ? 'LOPSIDED' : 'HIGHWAY ROBBERY';
    const verdictColor = avDiff <= 20 ? COLORS.SUCCESS : avDiff <= 60 ? COLORS.GOLD : avDiff <= 120 ? COLORS.ORANGE : COLORS.DANGER;

    const formatSide = (players: any[], pickRounds: ParsedPick[]): string => {
      const lines: string[] = [];
      players.forEach((p: any) => {
        lines.push(`**[${p.first_name} ${p.last_name}](https://accessgrantedsportz.com/player/${p.id})**\n${p.position} · ${p.team_abbr || 'FA'}\nOVR ${p.overall_rating} · Age ${p.age} · Spd ${p.speed}\n${getDevTraitLabel(p.dev_trait)}\nAV **${p.av.toFixed(0)}**`);
      });
      pickRounds.forEach(p => {
        const roundLabel = p.round === 1 ? '1st' : p.round === 2 ? '2nd' : p.round === 3 ? '3rd' : `${p.round}th`;
        const yearStr = p.yearsOut > 0 ? ` (+${p.yearsOut} Yr)` : '';
        lines.push(`**${roundLabel} Round Pick${yearStr}**\nAV **${getDraftPickValue(p.round, null, p.yearsOut)}** · Generic slot value`);
      });
      return lines.join('\n\n') || 'None';
    };

    const mainEmbed = new EmbedBuilder()
      .setColor(verdictColor as any)
      .setTitle(`Trade Analysis  ·  ${league.name}`)
      .setDescription(`**${verdict}** ·  AV Gap: **${avDiff.toFixed(0)}** ·  **${winnerTeam}** has the advantage`)
      .addFields(
        { name: `Offering Side`, value: formatSide(enrichedOffered, offeringPickRounds).slice(0, 1024), inline: true },
        { name: `Requesting Side`, value: formatSide(enrichedRequested, requestingPickRounds).slice(0, 1024), inline: true },
        { name: 'AV Summary', value: `Offering total **${totalOfferedAV.toFixed(0)} AV**\nRequesting total **${totalRequestedAV.toFixed(0)} AV**\nGap **${avDiff.toFixed(0)} AV**`, inline: false }
      ).setFooter({ text: 'AccessGrantedSportz' }).setTimestamp();

    await interaction.editReply({ embeds: [mainEmbed] });
    
    const advice = await generateTradeAdvice(enrichedOffered.map((p: any) => p.id), enrichedRequested.map((p: any) => p.id), league.id, league.current_season);
    await interaction.followUp({ embeds: [new EmbedBuilder().setColor(verdictColor as any).setTitle('Trade Advisor').setDescription(advice.advice.slice(0, 4096))] });

  } catch (error) {
    console.error('Tradecheck error:', error);
    try { await interaction.editReply({ content: 'Error analyzing trade.' }); } catch { }
  }
};