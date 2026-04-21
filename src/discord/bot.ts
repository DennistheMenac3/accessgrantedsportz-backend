import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Interaction,
  TextChannel
} from 'discord.js';
import { query } from '../config/database';
import { buildTeamDashboardEmbed, buildRosterEmbed, buildTeamButtons } from './commands/team';

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

  try {
    await query('SELECT 1');
    console.log('✅ Discord bot database connection ready');
  } catch (error) {
    console.error('❌ Discord bot database warmup failed:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {

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

  if (interaction.isButton()) {
    try {
      // --- TEAM DASHBOARD & ROSTER PAGINATION ---
      if (interaction.customId.startsWith('teamview_')) {
        // 1. TELL DISCORD WE ARE THINKING (Prevents 3-second timeout)
        await interaction.deferUpdate();

        const [, teamId, pageStr] = interaction.customId.split('_');
        const targetPage = parseInt(pageStr, 10);
        
        // 2. RUN THE DB QUERIES
        const teamRes = await query(
          `SELECT id, name, city, abbreviation, overall_rating, team_logo_url FROM teams WHERE id = $1`, 
          [teamId]
        );
        const rosterRes = await query(
          `SELECT p.first_name, p.last_name, p.position, p.overall_rating, p.age, p.speed, tvh.total_value 
           FROM players p LEFT JOIN trade_value_history tvh ON p.id = tvh.player_id
           WHERE p.team_id = $1 ORDER BY p.overall_rating DESC`,
          [teamId]
        );

        if (teamRes.rows.length === 0 || rosterRes.rows.length === 0) {
          // Use editReply because we already deferred
          await interaction.editReply({ content: '❌ Data expired or not found.', components: [], embeds: [] });
          return;
        }

        const team = teamRes.rows[0];
        const players = rosterRes.rows;
        const totalPages = Math.ceil(players.length / 10);

        let newEmbed;
        if (targetPage === 0) {
            const gamesRes = await query(
                `SELECT home_team_id, away_team_id, home_score, away_score FROM games WHERE home_team_id = $1 OR away_team_id = $1`,
                [team.id]
            );
            let w = 0, l = 0, t = 0, pf = 0, pa = 0;
            gamesRes.rows.forEach(game => {
                const isHome = game.home_team_id === team.id;
                const ptFor = isHome ? game.home_score : game.away_score;
                const ptAgn = isHome ? game.away_score : game.home_score;
                pf += ptFor; pa += ptAgn;
                if (ptFor > ptAgn) w++; else if (ptFor < ptAgn) l++; else t++;
            });
            const totalTVS = players.reduce((sum: number, p: any) => sum + (parseFloat(p.total_value) || 0), 0);
            
            newEmbed = buildTeamDashboardEmbed(team, players, w, l, t, pf, pa, totalTVS);
        } else {
            newEmbed = buildRosterEmbed(team, players, targetPage, totalPages);
        }

        const newButtons = buildTeamButtons(teamId, targetPage, totalPages);
        
        // 3. EDIT THE REPLY WITH THE NEW PAGE
        await interaction.editReply({ embeds: [newEmbed], components: [newButtons] });
        return;
      }

      // --- TRADE APPROVAL ENGINE ---
      const [action, type, tradeId] = interaction.customId.split('_');
      if (type === 'trade') {
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

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error: any) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    if (error.code === 10062 || error.code === 40060) return;
    try {
      const msg = '❌ There was an error executing this command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch { }
  }
});

export const postToChannel = async (channelId: string, content: string): Promise<void> => {
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

export const splitMessage = (text: string, maxLength: number): string[] => {
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