import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Interaction,
  TextChannel
} from 'discord.js';
import { query } from '../config/database';

// =============================================
// Discord Client Setup
// =============================================
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Collection to store commands
export const commands = new Collection<string, any>();

// =============================================
// Bot Ready Event
// =============================================
client.once(Events.ClientReady, (readyClient) => {
  console.log(`🤖 Discord bot logged in as ${readyClient.user.tag}`);
  console.log(`📡 Bot is in ${readyClient.guilds.cache.size} servers`);
});

// =============================================
// Handle Slash Commands
// =============================================
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: '❌ There was an error executing this command.',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ There was an error executing this command.',
        ephemeral: true
      });
    }
  }
});

// =============================================
// Helper — Post to a Discord channel
// Used for auto-posts
// =============================================
export const postToChannel = async (
  channelId: string,
  content:   string
): Promise<void> => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel instanceof TextChannel) {
      // Discord has a 2000 character limit per message
      // Split long content into chunks
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
// Helper — Split long messages
// Discord has a 2000 char limit per message
// =============================================
export const splitMessage = (
  text:      string,
  maxLength: number
): string[] => {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

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
// Start the bot
// =============================================
export const startBot = async (): Promise<void> => {
  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
  }
};