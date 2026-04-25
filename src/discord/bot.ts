import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Interaction,
  TextChannel
} from 'discord.js';
import { query } from '../config/database';
import { COLORS, createEmbed } from '../config/brand';
import {
  buildTeamDashboardEmbed,
  buildRosterEmbed,
  buildTeamButtons
} from './commands/team';

export const client   = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

export const commands = new Collection<string, any>();

// =============================================
// BOT READY
// =============================================
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🤖 Discord bot logged in as ${readyClient.user.tag}`);
  console.log(`📡 Bot is in ${readyClient.guilds.cache.size} servers`);
  try {
    await query('SELECT 1');
    console.log('✅ Discord bot database connection ready');
  } catch (error) {
    console.error('❌ Discord bot database warmup failed:', error);
  }
});

// =============================================
// INTERACTION HANDLER
// =============================================
client.on(Events.InteractionCreate, async (interaction: Interaction) => {

  // =============================================
  // AUTOCOMPLETE
  // =============================================
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(
          `Autocomplete error for ${interaction.commandName}:`, error
        );
      }
    }
    return;
  }

  // =============================================
  // BUTTON INTERACTIONS
  // =============================================
  if (interaction.isButton()) {
    try {
      const { customId } = interaction;

      // ----------------------------------------
      // TEAM DASHBOARD PAGINATION
      // ----------------------------------------
      if (customId.startsWith('teamview_')) {
        await interaction.deferUpdate();

        const [, teamId, pageStr] = customId.split('_');
        const targetPage          = parseInt(pageStr, 10);

        const [teamRes, rosterRes] = await Promise.all([
          query(
            `SELECT id, name, city, abbreviation,
              overall_rating, team_logo_url
             FROM teams WHERE id = $1`,
            [teamId]
          ),
          query(
            `SELECT p.first_name, p.last_name, p.position,
              p.overall_rating, p.age, p.speed,
              tvh.total_value
             FROM players p
             LEFT JOIN trade_value_history tvh
               ON p.id = tvh.player_id
             WHERE p.team_id = $1
             ORDER BY p.overall_rating DESC`,
            [teamId]
          )
        ]);

        if (
          teamRes.rows.length === 0 ||
          rosterRes.rows.length === 0
        ) {
          await interaction.editReply({
            content:    'Data expired or not found.',
            components: [],
            embeds:     []
          });
          return;
        }

        const team       = teamRes.rows[0];
        const players    = rosterRes.rows;
        const totalPages = Math.ceil(players.length / 10);

        let newEmbed;
        if (targetPage === 0) {
          const gamesRes = await query(
            `SELECT home_team_id, away_team_id,
              home_score, away_score
             FROM games
             WHERE home_team_id = $1
             OR    away_team_id = $1`,
            [team.id]
          );

          let w = 0, l = 0, t = 0, pf = 0, pa = 0;
          gamesRes.rows.forEach((game: any) => {
            const isHome = game.home_team_id === team.id;
            const ptFor  = isHome ? game.home_score : game.away_score;
            const ptAgn  = isHome ? game.away_score : game.home_score;
            pf += ptFor; pa += ptAgn;
            if      (ptFor > ptAgn) w++;
            else if (ptFor < ptAgn) l++;
            else                    t++;
          });

          const totalAV = players.reduce(
            (sum: number, p: any) =>
              sum + (parseFloat(p.total_value) || 0),
            0
          );

          newEmbed = buildTeamDashboardEmbed(
            team, players, w, l, t, pf, pa, totalAV
          );
        } else {
          newEmbed = buildRosterEmbed(
            team, players, targetPage, totalPages
          );
        }

        const newButtons = buildTeamButtons(
          teamId, targetPage, totalPages
        );

        await interaction.editReply({
          embeds:     [newEmbed],
          components: [newButtons]
        });
        return;
      }

      // ----------------------------------------
      // TRADE APPROVAL ENGINE
      // ----------------------------------------
      if (customId.startsWith('approve_trade_')) {
        const tradeId = customId.replace('approve_trade_', '');

        // Verify commissioner
        const commishCheck = await query(
          `SELECT u.discord_user_id
           FROM leagues l
           JOIN users u ON u.id = l.owner_id
           WHERE l.discord_guild_id = $1`,
          [interaction.guildId]
        );

        const isCommish =
          commishCheck.rows[0]?.discord_user_id === interaction.user.id ||
          (interaction.member as any)?.roles?.cache?.some(
            (r: any) => r.name.toLowerCase() === 'commissioner'
          );

        if (!isCommish) {
          await interaction.reply({
            content:   'Only the Commissioner can approve trades.',
            ephemeral: true
          });
          return;
        }

        // Get trade
        const tradeResult = await query(
          `SELECT * FROM trades WHERE id = $1`,
          [tradeId]
        );

        if (tradeResult.rows.length === 0) {
          await interaction.reply({
            content:   'Trade not found.',
            ephemeral: true
          });
          return;
        }

        const trade = tradeResult.rows[0];

        // Move players to new teams
        const proposerPlayers = JSON.parse(
          trade.proposer_players || '[]'
        );
        const partnerPlayers  = JSON.parse(
          trade.partner_players  || '[]'
        );

        await Promise.all([
          ...proposerPlayers.map((playerId: string) =>
            query(
              `UPDATE players SET team_id = $1 WHERE id = $2`,
              [trade.partner_team_id, playerId]
            )
          ),
          ...partnerPlayers.map((playerId: string) =>
            query(
              `UPDATE players SET team_id = $1 WHERE id = $2`,
              [trade.proposer_team_id, playerId]
            )
          )
        ]);

        // Update trade status
        await query(
          `UPDATE trades SET status = 'approved', updated_at = NOW()
           WHERE id = $1`,
          [tradeId]
        );

        await interaction.update({
          embeds: [createEmbed(COLORS.SUCCESS)
            .setTitle('Trade Approved')
            .setDescription(
              `Trade approved by <@${interaction.user.id}>.\n` +
              `Players have been moved to their new teams.\n` +
              `Trade ID: \`${tradeId}\``
            )],
          components: []
        });
        return;
      }

      // ----------------------------------------
      // TRADE DENIAL
      // ----------------------------------------
      if (customId.startsWith('deny_trade_')) {
        const tradeId = customId.replace('deny_trade_', '');

        const commishCheck = await query(
          `SELECT u.discord_user_id
           FROM leagues l
           JOIN users u ON u.id = l.owner_id
           WHERE l.discord_guild_id = $1`,
          [interaction.guildId]
        );

        const isCommish =
          commishCheck.rows[0]?.discord_user_id === interaction.user.id ||
          (interaction.member as any)?.roles?.cache?.some(
            (r: any) => r.name.toLowerCase() === 'commissioner'
          );

        if (!isCommish) {
          await interaction.reply({
            content:   'Only the Commissioner can deny trades.',
            ephemeral: true
          });
          return;
        }

        await query(
          `UPDATE trades SET status = 'denied', updated_at = NOW()
           WHERE id = $1`,
          [tradeId]
        );

        await interaction.update({
          embeds: [createEmbed(COLORS.DANGER)
            .setTitle('Trade Denied')
            .setDescription(
              `Trade denied by <@${interaction.user.id}>.\n` +
              `Trade ID: \`${tradeId}\``
            )],
          components: []
        });
        return;
      }

      // ----------------------------------------
      // COUNTER REQUEST
      // ----------------------------------------
      if (customId.startsWith('counter_trade_')) {
        const tradeId = customId.replace('counter_trade_', '');

        await query(
          `UPDATE trades
           SET status     = 'counter_requested',
               updated_at = NOW()
           WHERE id = $1`,
          [tradeId]
        );

        await interaction.update({
          embeds: [createEmbed(COLORS.GOLD)
            .setTitle('Counter Requested')
            .setDescription(
              `A counter offer has been requested by ` +
              `<@${interaction.user.id}>.\n` +
              `The proposing team should resubmit with adjusted terms.\n` +
              `Trade ID: \`${tradeId}\``
            )],
          components: []
        });
        return;
      }

      // ----------------------------------------
      // FORCE WIN BUTTONS
      // ----------------------------------------
      if (
        customId.startsWith('fw_away_') ||
        customId.startsWith('fw_home_')
      ) {
        const isAway  = customId.startsWith('fw_away_');
        const gameId  = customId
          .replace('fw_away_', '')
          .replace('fw_home_', '');

        const commishCheck = await query(
          `SELECT u.discord_user_id
           FROM leagues l
           JOIN users u ON u.id = l.owner_id
           WHERE l.discord_guild_id = $1`,
          [interaction.guildId]
        );

        if (
          commishCheck.rows[0]?.discord_user_id !== interaction.user.id
        ) {
          await interaction.reply({
            content:   'Only the Commissioner can issue force wins.',
            ephemeral: true
          });
          return;
        }

        const gameResult = await query(
          `SELECT g.*,
            ht.name as home_team,
            ht.abbreviation as home_abbr,
            at.name as away_team,
            at.abbreviation as away_abbr
           FROM games g
           JOIN teams ht ON ht.id = g.home_team_id
           JOIN teams at ON at.id = g.away_team_id
           WHERE g.id = $1`,
          [gameId]
        );

        if (gameResult.rows.length === 0) {
          await interaction.reply({
            content:   'Game not found.',
            ephemeral: true
          });
          return;
        }

        const game      = gameResult.rows[0];
        const homeScore = isAway ? 0  : 27;
        const awayScore = isAway ? 27 : 0;
        const winnerAbbr = isAway ? game.away_abbr : game.home_abbr;
        const winner    = isAway ? game.away_team  : game.home_team;

        await query(
          `UPDATE games SET
            home_score     = $1,
            away_score     = $2,
            is_force_win   = true,
            force_win_team = $3
           WHERE id = $4`,
          [homeScore, awayScore, winnerAbbr, gameId]
        );

        await interaction.reply({
          embeds: [createEmbed(COLORS.WARNING)
            .setTitle(`Force Win  ·  ${winnerAbbr}`)
            .setDescription(
              `**${winner}** has been awarded a force win.\n` +
              `${game.away_team} @ ${game.home_team}`
            )]
        });
        return;
      }

      // ----------------------------------------
      // SCHEDULE GAME BUTTON
      // ----------------------------------------
      if (customId.startsWith('schedule_')) {
        const gameId = customId.replace('schedule_', '');
        await interaction.reply({
          content:   `To schedule this game use: \`/schedule game:${gameId}\``,
          ephemeral: true
        });
        return;
      }

      // ----------------------------------------
      // MARK PLAYED BUTTON
      // ----------------------------------------
      if (customId.startsWith('played_')) {
        await interaction.reply({
          content:   'Submit your scores via the Companion App export.',
          ephemeral: true
        });
        return;
      }

    } catch (error) {
      console.error('Button interaction error:', error);
    }
    return;
  }

  // =============================================
  // SLASH COMMANDS
  // =============================================
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error: any) {
    console.error(`Error executing ${interaction.commandName}:`, error);

    const errorString = error.message || 'Unknown Error';
    const msg =
      `Application Error:\n\`\`\`\n${errorString}\n\`\`\``;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content:    msg,
          embeds:     [],
          components: []
        });
      } else {
        await interaction.reply({
          content:   msg,
          ephemeral: true
        });
      }
    } catch { /* ignore */ }
  }
});

// =============================================
// POST TO CHANNEL
// =============================================
export const postToChannel = async (
  channelId: string,
  content:   string
): Promise<void> => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel instanceof TextChannel) {
      if (content.length <= 2000) {
        await channel.send(content);
      } else {
        const chunks = splitMessage(content, 2000);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    }
  } catch (error) {
    console.error('Error posting to Discord channel:', error);
  }
};

// =============================================
// SPLIT MESSAGE
// =============================================
export const splitMessage = (
  text:      string,
  maxLength: number
): string[] => {
  const chunks: string[] = [];
  const lines   = text.split('\n');
  let current   = '';

  for (const line of lines) {
    if ((current + '\n' + line).length > maxLength) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
};

// =============================================
// START BOT
// =============================================
export const startBot = async (): Promise<void> => {
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
  }
};