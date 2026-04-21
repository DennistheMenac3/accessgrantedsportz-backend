import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction
} from 'discord.js';
import { query } from '../../config/database';
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
      p.years_pro, p.portrait_url,
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
  .setName('compare')
  .setDescription('Compare two players side by side')
  .addStringOption(option =>
    option
      .setName('player1')
      .setDescription('First player (supports autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option
      .setName('player2')
      .setDescription('Second player (supports autocomplete)')
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

    const input1 = interaction.options.getString('player1', true);
    const input2 = interaction.options.getString('player2', true);

    const [p1, p2] = await Promise.all([
      findPlayer(input1, league.id),
      findPlayer(input2, league.id)
    ]);

    if (!p1) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No player matching "${input1}" found.\n` +
            `Try the autocomplete dropdown for best results.`
          )]
      });
      return;
    }
    if (!p2) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('Player Not Found')
          .setDescription(
            `No player matching "${input2}" found.\n` +
            `Try the autocomplete dropdown for best results.`
          )]
      });
      return;
    }

    const v1     = parseFloat(p1.trade_value);
    const v2     = parseFloat(p2.trade_value);
    const diff   = Math.abs(v1 - v2);
    const winner = v1 >= v2 ? p1 : p2;

    const verdict =
      diff <= 10  ? 'EVEN'             :
      diff <= 25  ? 'SLIGHT EDGE'      :
      diff <= 50  ? 'CLEAR ADVANTAGE'  :
      diff <= 100 ? 'LOPSIDED'         :
      'HIGHWAY ROBBERY';

    const profileUrl1 = `https://accessgrantedsportz.com/player/${p1.id}`;
    const profileUrl2 = `https://accessgrantedsportz.com/player/${p2.id}`;

    const embed = createTradeEmbed(diff)
      .setTitle('Player Comparison  ·  AccessGrantedSportz')
      .setDescription(
        `${verdict}  ·  ` +
        `${winner.first_name} ${winner.last_name} leads by ` +
        `${diff.toFixed(1)} TVS`
      )
      .addFields(
        {
          name:   `${p1.first_name} ${p1.last_name}`,
          value:
            `[View Profile](${profileUrl1})\n` +
            `${p1.position}  ·  ${p1.team_abbr || 'FA'} ` +
            `(${p1.wins || 0}-${p1.losses || 0})\n` +
            `OVR: ${p1.overall_rating}  ·  ` +
            `Age: ${p1.age}  ·  ` +
            `Spd: ${p1.speed}\n` +
            `${getDevTraitLabel(p1.dev_trait)}\n` +
            `TVS: ${v1.toFixed(1)}`,
          inline: true
        },
        {
          name:   `${p2.first_name} ${p2.last_name}`,
          value:
            `[View Profile](${profileUrl2})\n` +
            `${p2.position}  ·  ${p2.team_abbr || 'FA'} ` +
            `(${p2.wins || 0}-${p2.losses || 0})\n` +
            `OVR: ${p2.overall_rating}  ·  ` +
            `Age: ${p2.age}  ·  ` +
            `Spd: ${p2.speed}\n` +
            `${getDevTraitLabel(p2.dev_trait)}\n` +
            `TVS: ${v2.toFixed(1)}`,
          inline: true
        }
      )
      .setFooter({
        text: 'TVS — Trade Value Score  ·  AccessGrantedSportz'
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('Compare error:', error);
    await interaction.editReply({
      embeds: [createEmbed(COLORS.DANGER)
        .setTitle('Error')
        .setDescription('Error comparing players. Please try again.')]
    });
  }
};