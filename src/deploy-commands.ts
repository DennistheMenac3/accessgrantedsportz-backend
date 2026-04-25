import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

// Import all of your existing command data exactly as you do in index.ts
import { data as rankingsCmd }   from './discord/commands/rankings';
import { data as rumorsCmd }     from './discord/commands/rumors';
import { data as standingsCmd }  from './discord/commands/standings';
import { data as gemsCmd }       from './discord/commands/gems';
import { data as leadersCmd }    from './discord/commands/leaders';
import { data as awardsCmd }     from './discord/commands/awards';
import { data as recapCmd }      from './discord/commands/recap';
import { data as inviteCmd }     from './discord/commands/invite';
import { data as scoresCmd }     from './discord/commands/scores';
import { data as joinCmd }       from './discord/commands/join';
import { data as claimCmd }      from './discord/commands/claim';
import { data as tradeCmd }      from './discord/commands/trade';
import { data as teamCmd }       from './discord/commands/team';
import { data as valueCmd }      from './discord/commands/value';
import { data as compareCmd }    from './discord/commands/compare';
import { data as scoutCmd }      from './discord/commands/scout';
import { data as tradecheckCmd } from './discord/commands/tradecheck';
import { data as playerCmd }     from './discord/commands/player';

// Package them into an array
const commands = [
  rankingsCmd, rumorsCmd, standingsCmd, gemsCmd, leadersCmd,
  awardsCmd, recapCmd, inviteCmd, scoresCmd, joinCmd, claimCmd,
  tradeCmd, teamCmd, valueCmd, compareCmd, scoutCmd, tradecheckCmd,
  playerCmd
].map(cmd => cmd.toJSON());

// Initialize the Discord REST API client
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN as string);

(async () => {
  try {
    console.log(`🚀 Started refreshing ${commands.length} application (/) commands...`);

    if (!process.env.DISCORD_CLIENT_ID) {
      throw new Error('❌ Missing DISCORD_CLIENT_ID in your .env file!');
    }

    // Push the updated commands to Discord globally
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands },
    );

    console.log(`✅ Successfully reloaded all application (/) commands!`);
  } catch (error) {
    console.error('❌ Failed to deploy commands:', error);
  }
})();