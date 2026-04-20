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

  // Handle autocomplete
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