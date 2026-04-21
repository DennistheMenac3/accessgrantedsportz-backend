import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { query } from '../../config/database';
import { COLORS, createEmbed, getDevTraitIcon, getDevTraitLabel } from '../../config/brand';

// =============================================
// POSITION GROUP MAPPINGS
// EA uses REDGE/LEDGE not REDG/LEDG
// =============================================
const POSITION_GROUPS: { [key: string]: string[] } = {
  'QB':  ['QB'],
  'RB':  ['RB'],
  'WR':  ['WR'],
  'TE':  ['TE'],
  'OL':  ['LT', 'LG', 'C', 'RG', 'RT'],
  'DL':  ['LE', 'RE', 'DT', 'LEDG', 'REDG', 'LEDGE', 'REDGE'],
  'LB':  ['LOLB', 'MLB', 'ROLB', 'SAM', 'MIKE', 'WILL'],
  'DB':  ['CB', 'FS', 'SS'],
  'K/P': ['K', 'P', 'LS']
};

const getLeagueForServer = async (guildId: string): Promise<any | null> => {
  const result = await query(
    `SELECT l.*,
      COALESCE((SELECT MAX(g.season) FROM games g
                WHERE g.league_id = l.id), 1) as current_season
     FROM leagues l
     WHERE l.discord_guild_id = $1
     LIMIT 1`,
    [guildId]
  );
  return result.rows[0] || null;
};

export const data = new SlashCommandBuilder()
  .setName('player')
  .setDescription('🔍 Search for a player by name or position group')
  .addStringOption(option =>
    option
      .setName('name')
      .setDescription('Player name (supports autocomplete)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  .addStringOption(option =>
    option
      .setName('group')
      .setDescription('Filter by position group')
      .setRequired(false)
      .addChoices(
        { name: '🏈 QB — Quarterbacks',       value: 'QB'  },
        { name: '🏃 RB — Running Backs',       value: 'RB'  },
        { name: '🙌 WR — Wide Receivers',      value: 'WR'  },
        { name: '💪 TE — Tight Ends',          value: 'TE'  },
        { name: '🛡️ OL — Offensive Line',     value: 'OL'  },
        { name: '💥 DL — Defensive Line',      value: 'DL'  },
        { name: '⚡ LB — Linebackers',         value: 'LB'  },
        { name: '🔒 DB — Defensive Backs',     value: 'DB'  },
        { name: '🦵 K/P — Specialists',        value: 'K/P' }
      )
  )
  .addBooleanOption(option =>
    option
      .setName('rookies')
      .setDescription('Show rookies only (years pro = 0)')
      .setRequired(false)
  );

// =============================================
// AUTOCOMPLETE HANDLER
// =============================================
export const autocomplete = async (
  interaction: AutocompleteInteraction
): Promise<void> => {
  const league = await getLeagueForServer(interaction.guildId!);
  if (!league) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  if (!focused || focused.length < 2) {
    await interaction.respond([]);
    return;
  }

  try {
    const result = await query(
      `SELECT
        p.id, p.first_name, p.last_name,
        p.position, t.abbreviation
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
  } catch {
    await interaction.respond([]);
  }
};

// =============================================
// EXECUTE HANDLER
// =============================================
export const execute = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  try {
    await interaction.deferReply();
  } catch {
    return;
  }

  try {
    const league = await getLeagueForServer(interaction.guildId!);
    if (!league) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ No League Connected')
          .setDescription('No league is connected to this server.')]
      });
      return;
    }

    const nameInput   = interaction.options.getString('name');
    const group       = interaction.options.getString('group');
    const rookiesOnly = interaction.options.getBoolean('rookies') ?? false;

    const devLabel = (dev: string) =>
      dev === 'xfactor'   ? '⚡ XF'   :
      dev === 'superstar' ? '⭐ SS'   :
      dev === 'star'      ? '🌟 Star' : '📋';

    // Single player via autocomplete UUID
    if (nameInput && nameInput.length === 36 && nameInput.includes('-')) {
      const result = await query(
        `SELECT p.*,
  p.portrait_url,
  t.name         as team_name,
  t.abbreviation as team_abbr,
  t.wins, t.losses,
  COALESCE(tvh.total_value, 0) as trade_value,
  tvh.value_breakdown
FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
         LEFT JOIN trade_value_history tvh
           ON tvh.player_id  = p.id
           AND tvh.league_id = p.league_id
         WHERE p.id = $1
         ORDER BY tvh.calculated_at DESC
         LIMIT 1`,
        [nameInput]
      );

      if (result.rows.length === 0) {
        await interaction.editReply({
          embeds: [createEmbed(COLORS.DANGER)
            .setTitle('❌ Player Not Found')
            .setDescription('Could not find that player.')]
        });
        return;
      }

      await sendPlayerCard(interaction, result.rows[0]);
      return;
    }

    // Build query
    const conditions: string[] = [`p.league_id = $1`];
    const params: any[]        = [league.id];
    let   paramCount           = 2;

    if (group && POSITION_GROUPS[group]) {
      const positions    = POSITION_GROUPS[group];
      const placeholders = positions.map(() => `$${paramCount++}`).join(', ');
      conditions.push(`p.position IN (${placeholders})`);
      params.push(...positions);
    }

    if (nameInput) {
      conditions.push(
        `LOWER(p.first_name || ' ' || p.last_name) LIKE LOWER($${paramCount})`
      );
      params.push(`%${nameInput}%`);
      paramCount++;
    }

    if (rookiesOnly) {
      conditions.push(`p.years_pro = 0`);
    }

    const result = await query(
      `SELECT
        p.id, p.first_name, p.last_name,
        p.position, p.overall_rating,
        p.age, p.speed, p.dev_trait,
        p.years_pro,
        t.name         as team_name,
        t.abbreviation as team_abbr,
        t.wins, t.losses,
        COALESCE(tvh.total_value, 0) as trade_value
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN trade_value_history tvh
         ON tvh.player_id  = p.id
         AND tvh.league_id = p.league_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.overall_rating DESC, tvh.total_value DESC
       LIMIT 10`,
      params
    );

    if (result.rows.length === 0) {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.NAVY)
          .setTitle('🔍 No Players Found')
          .setDescription('No players match your search.')]
      });
      return;
    }

    // Single match — show full card
    if (result.rows.length === 1) {
      await sendPlayerCard(interaction, result.rows[0]);
      return;
    }

    // Multiple results — show list
    const groupLabel =
      group       ? `${group} Group${rookiesOnly ? ' · Rookies' : ''}` :
      nameInput   ? `"${nameInput}"${rookiesOnly ? ' · Rookies' : ''}` :
      rookiesOnly ? 'Rookies' : 'Players';

    const fields = result.rows.map((p: any, i: number) => ({
      name:
        `${i + 1}. ${p.first_name} ${p.last_name} ${devLabel(p.dev_trait)}`,
      value:
        `**${p.position}** | ${p.team_abbr || 'FA'} ` +
        `(${p.wins || 0}-${p.losses || 0})\n` +
        `OVR: **${p.overall_rating || '?'}** | ` +
        `Spd: ${p.speed || '?'} | ` +
        `Age: ${p.age || '?'} | ` +
        `TVS: **${parseFloat(p.trade_value).toFixed(1)}**`,
      inline: false
    }));

    await interaction.editReply({
      embeds: [createEmbed(COLORS.NAVY)
        .setTitle(`🔍 ${groupLabel} | ${league.name}`)
        .setDescription(`Top ${result.rows.length} players by OVR`)
        .addFields(fields)
        .setFooter({
          text: 'Use /player name:[player] for full card • AccessGrantedSportz'
        })]
    });

  } catch (error) {
    console.error('Player command error:', error);
    try {
      await interaction.editReply({
        embeds: [createEmbed(COLORS.DANGER)
          .setTitle('❌ Error')
          .setDescription('Error searching players. Please try again.')]
      });
    } catch { /* ignore */ }
  }
};

// =============================================
// PLAYER CARD — Full detail embed
// =============================================
const sendPlayerCard = async (
  interaction: ChatInputCommandInteraction,
  player:      any
): Promise<void> => {
  const tradeValue = parseFloat(player.trade_value || '0');
  const breakdown  = player.value_breakdown || {};
  const devLabel   = getDevTraitLabel(player.dev_trait);
  const devIcon    = getDevTraitIcon(player.dev_trait);
  const profileUrl = `https://accessgrantedsportz.com/player/${player.id}`;

  const valueColor =
    tradeValue >= 200 ? COLORS.GOLD   :
    tradeValue >= 100 ? COLORS.ORANGE :
    COLORS.NAVY;

  const valueTier =
    tradeValue >= 200 ? 'ELITE'          :
    tradeValue >= 150 ? 'FRANCHISE'      :
    tradeValue >= 100 ? 'PREMIUM'        :
    tradeValue >= 50  ? 'SOLID STARTER'  :
    'BENCHWARMER';

  const record = player.team_abbr
    ? `${player.wins || 0}-${player.losses || 0}`
    : '';

  const embed = createEmbed(valueColor)
    .setAuthor({
      name:    devLabel,
      iconURL: devIcon
    })
    .setTitle(
      `${player.first_name} ${player.last_name}  ·  ` +
      `${player.position}  ·  ` +
      `${player.team_abbr || 'Free Agent'}  ·  ` +
      `${player.overall_rating || '—'} OVR`
    )
    .setURL(profileUrl)
    .setDescription(
      `${player.team_name || 'Free Agent'}` +
      `${record ? `  (${record})` : ''}`
    )
    .addFields(
      {
        name:   'Ratings',
        value:
          `Overall    ${player.overall_rating || '—'}\n` +
          `Speed       ${player.speed         || '—'}\n` +
          `Age          ${player.age          || '—'}\n` +
          `Experience  ${player.years_pro ?? '—'} yrs`,
        inline: true
      },
      {
        name:   'Trade Value',
        value:
          `TVS   ${tradeValue.toFixed(1)}\n` +
          `Tier   ${valueTier}`,
        inline: true
      }
    );

  // Portrait — right side thumbnail
  if (player.portrait_url) {
    embed.setThumbnail(player.portrait_url);
  }

  // Abilities
  if (player.abilities && player.abilities.length > 0) {
    embed.addFields({
      name:   'Abilities',
      value:  player.abilities
        .map((a: any) => a.ability_name || a)
        .join(', '),
      inline: false
    });
  }

  // Key attributes
  if (breakdown && Object.keys(breakdown).length > 0) {
    embed.addFields({
      name:   'Value Breakdown',
      value:
        `Base ${breakdown.base_value         || 0}  ·  ` +
        `Speed ${breakdown.speed_bonus       || 0}  ·  ` +
        `Dev ${breakdown.dev_trait_age_bonus || 0}\n` +
        `Age ×${breakdown.age_multiplier        || 1}  ·  ` +
        `Position ×${breakdown.position_multiplier || 1}  ·  ` +
        `Dev ×${breakdown.dev_trait_multiplier  || 1}`,
      inline: false
    });
  }

  // Contract
  if (player.contract_salary) {
    embed.addFields({
      name:   'Contract',
      value:
        `Salary  $${(player.contract_salary / 1000000).toFixed(2)}M\n` +
        `Years    ${player.contract_years || '—'}`,
      inline: true
    });
  }

  // Footer — clean, no emojis
  embed
    .setFooter({
      text:
        'TVS — Trade Value Score  ·  ' +
        'ELITE 200+  ·  FRANCHISE 150+  ·  PREMIUM 100+  ·  ' +
        'SOLID 50+  ·  BENCHWARMER <50  ·  ' +
        'AccessGrantedSportz'
    })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
};