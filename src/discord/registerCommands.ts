import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

import { data as rankingsData }   from './commands/rankings';
import { data as rumorsData }     from './commands/rumors';
import { data as scoutData }      from './commands/scout';
import { data as standingsData }  from './commands/standings';
import { data as gemsData }       from './commands/gems';
import { data as leadersData }    from './commands/leaders';
import { data as valueData }      from './commands/value';
import { data as compareData }    from './commands/compare';
import { data as awardsData }     from './commands/awards';
import { data as recapData }      from './commands/recap';
import { data as scoresData }     from './commands/scores';
import { data as tradecheckData } from './commands/tradecheck';
import { data as inviteData }     from './commands/invite';
import { data as joinData }  from './commands/join';
import { data as claimData } from './commands/claim';

const commands = [
  rankingsData.toJSON(),
  rumorsData.toJSON(),
  scoutData.toJSON(),
  standingsData.toJSON(),
  gemsData.toJSON(),
  leadersData.toJSON(),
  valueData.toJSON(),
  compareData.toJSON(),
  awardsData.toJSON(),
  recapData.toJSON(),
  scoresData.toJSON(),
  tradecheckData.toJSON(),
  inviteData.toJSON(),
  joinData.toJSON(),
  claimData.toJSON(),
];

const rest = new REST().setToken(
  process.env.DISCORD_BOT_TOKEN!
);

const registerCommands = async () => {
  try {
    console.log('🔄 Registering Discord slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID!,
        '1261350703645982720'
      ),
      { body: commands }
    );

    console.log('✅ Successfully registered all slash commands!\n');
    console.log('📋 Commands registered:');
    commands.forEach((cmd: any) => {
      console.log(`   /${cmd.name.padEnd(12)} — ${cmd.description}`);
    });

  } catch (error) {
    console.error('Error registering commands:', error);
  }
};

registerCommands();