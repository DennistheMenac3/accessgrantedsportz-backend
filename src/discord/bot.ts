import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Interaction,
  TextChannel
} from 'discord.js';
import { query } from '../config/database';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

export const commands = new Collection<string, any>();

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`🤖 Discord bot logged in as ${readyClient.user.tag}`);
  console.log(`📡 Bot is in ${readyClient.guilds.cache.size} servers`);

  // Pre-warm database connection so first command is fast
  try {
    await query('SELECT 1');
    console.log('✅ Discord bot database connection ready');
  } catch (error) {
    console.error('❌ Discord bot database warmup failed:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {

  // =============================================
  // 1. HANDLE AUTOCOMPLETE
  // =============================================
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Autocomplete error for ${interaction.commandName}:`, error);
      }
    }
    return;
  }

  // =============================================
  // 2. HANDLE BUTTON CLICKS (Trades & Pagination)
  // =============================================
  if (interaction.isButton()) {
    try {
      // --- TEAM ROSTER PAGINATION ---
      if (interaction.customId.startsWith('teamroster_')) {
        const [, teamId, pageStr] = interaction.customId.split('_');
        const targetPage = parseInt(pageStr, 10);

        const teamRes = await query(`SELECT id, name, city, abbreviation FROM teams WHERE id = $1`, [teamId]);
        const rosterRes = await query(
          `SELECT p.first_name, p.last_name, p.position, p.overall_rating, p.age, p.speed, tvh.total_value 
           FROM players p LEFT JOIN trade_value_history tvh ON p.id = tvh.player_id
           WHERE p.team_id = $1 ORDER BY p.overall_rating DESC`,
          [teamId]
        );

        if (teamRes.rows.length === 0 || rosterRes.rows.length === 0) {
          return interaction.update({ content: '❌ Data expired or not found.', components: [], embeds: [] });
        }

        const players = rosterRes.rows;
        const totalPages = Math.ceil(players.length / 10);

        const { buildRosterEmbed, buildPaginationButtons } = require('./commands/team');
        const newEmbed = buildRosterEmbed(teamRes.rows[0], players, targetPage, totalPages);
        const newButtons = buildPaginationButtons(teamId, targetPage, totalPages);

        await interaction.update({ embeds: [newEmbed], components: [newButtons] });
        return;
      }

      // --- TRADE APPROVAL ENGINE ---
      const [action, type, tradeId] = interaction.customId.split('_');
      if (type === 'trade') {
        // Check for Commissioner permissions
        const member = interaction.member as any;
        const isCommish = member?.roles?.cache?.some((r: any) => r.name.toLowerCase() === 'commissioner');

        if (!isCommish) {
          return interaction.reply({ content: "🚫 Only the Commissioner can approve/deny trades.", ephemeral: true });
        }

        if (action === 'approve') {
          await query(`UPDATE trades SET status = 'approved' WHERE id = $1`, [tradeId]);
          await interaction.update({ content: '✅ **Trade Approved.**', components: [] });
        } else if (action === 'deny') {
          await query(`UPDATE trades SET status = 'denied' WHERE id = $1`, [tradeId]);
          await interaction.update({ content: '❌ **Trade Denied.**', components: [] });
        }
        return;
      }
    } catch (error) {
      console.error('Button interaction error:', error);
    }
    return;
  }

  // =============================================
  // 3. HANDLE SLASH COMMANDS
  // =============================================
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error: any) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    if (error.code === 10062) return;
    if (error.code === 40060) return;
    try {
      const msg = '❌ There was an error executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {
      // Silently ignore
    }
  }
});

// =============================================
// UTILITY FUNCTIONS
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

export const startBot = async (): Promise<void> => {
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
  }
};