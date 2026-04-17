import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);

const clearCommands = async () => {
  try {
    console.log('🧹 Clearing global commands...');
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
      { body: [] }
    );
    console.log('✅ Global commands cleared!');
  } catch (error) {
    console.error('Error:', error);
  }
};

clearCommands();