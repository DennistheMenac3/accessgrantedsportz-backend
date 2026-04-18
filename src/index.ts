import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pool from './config/database';

// Load environment variables
dotenv.config();

// Import routes
import authRoutes         from './routes/authRoutes';
import leagueRoutes       from './routes/leagueRoutes';
import teamRoutes         from './routes/teamRoutes';
import playerRoutes       from './routes/playerRoutes';
import gameRoutes         from './routes/gameRoutes';
import ingestionRoutes    from './routes/ingestionRoutes';
import tradeRoutes        from './routes/tradeRoutes';
import awardsRoutes       from './routes/awardsRoutes';
import storylineRoutes    from './routes/storylineRoutes';
import inviteRoutes       from './routes/inviteRoutes';
import leagueInviteRoutes from './routes/leagueInviteRoutes';
import discordAuthRoutes from './routes/discordAuthRoutes';

// Import Discord bot
import { startBot, commands } from './discord/bot';
import { data as rankingsCmd,   execute as rankingsExec   } from './discord/commands/rankings';
import { data as rumorsCmd,     execute as rumorsExec     } from './discord/commands/rumors';
import { data as scoutCmd,      execute as scoutExec      } from './discord/commands/scout';
import { data as standingsCmd,  execute as standingsExec  } from './discord/commands/standings';
import { data as gemsCmd,       execute as gemsExec       } from './discord/commands/gems';
import { data as leadersCmd,    execute as leadersExec    } from './discord/commands/leaders';
import { data as valueCmd,      execute as valueExec      } from './discord/commands/value';
import { data as compareCmd,    execute as compareExec    } from './discord/commands/compare';
import { data as awardsCmd,     execute as awardsExec     } from './discord/commands/awards';
import { data as recapCmd,      execute as recapExec      } from './discord/commands/recap';
import { data as tradecheckCmd, execute as tradecheckExec } from './discord/commands/tradecheck';
import { data as inviteCmd,     execute as inviteExec     } from './discord/commands/invite';
import { data as scoresCmd, execute as scoresExec } from './discord/commands/scores';
import { data as joinCmd,  execute as joinExec  } from './discord/commands/join';
import { data as claimCmd, execute as claimExec } from './discord/commands/claim';

// Import Scheduler
import { startScheduler } from './services/schedulerService';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      message:  '🏈 AccessGrantedSportz API is live!',
      version:  '1.0.0',
      status:   'running',
      database: '✅ connected'
    });
  } catch (error) {
    res.status(500).json({
      message:  '🏈 AccessGrantedSportz API is live!',
      version:  '1.0.0',
      status:   'running',
      database: '❌ disconnected'
    });
  }
});

// API Routes
app.use('/api/auth',                         authRoutes);
app.use('/api/leagues',                      leagueRoutes);
app.use('/api/leagues/:leagueId/teams',      teamRoutes);
app.use('/api/leagues/:leagueId/players',    playerRoutes);
app.use('/api/leagues/:leagueId/games',      gameRoutes);
app.use('/api/leagues/:leagueId/trades',     tradeRoutes);
app.use('/api/leagues/:leagueId/awards',     awardsRoutes);
app.use('/api/ingest',                       ingestionRoutes);
app.use('/api/leagues/:leagueId/storylines', storylineRoutes);
app.use('/api/invites',                      inviteRoutes);
app.use('/api/leagues/:leagueId/invites',    leagueInviteRoutes);
app.use('/api/leagues/:leagueId/members',    leagueInviteRoutes);
app.use('/api/auth', discordAuthRoutes);

// Register all Discord commands
commands.set(rankingsCmd.name,   { execute: rankingsExec });
commands.set(rumorsCmd.name,     { execute: rumorsExec });
commands.set(scoutCmd.name,      { execute: scoutExec });
commands.set(standingsCmd.name,  { execute: standingsExec });
commands.set(gemsCmd.name,       { execute: gemsExec });
commands.set(leadersCmd.name,    { execute: leadersExec });
commands.set(valueCmd.name,      { execute: valueExec });
commands.set(compareCmd.name,    { execute: compareExec });
commands.set(awardsCmd.name,     { execute: awardsExec });
commands.set(recapCmd.name,      { execute: recapExec });
commands.set(tradecheckCmd.name, { execute: tradecheckExec });
commands.set(inviteCmd.name,     { execute: inviteExec });
commands.set(scoresCmd.name, { execute: scoresExec });
commands.set(joinCmd.name,  { execute: joinExec });
commands.set(claimCmd.name, { execute: claimExec });

// Start scheduler
startScheduler();

// Start Discord bot
if (process.env.DISCORD_BOT_TOKEN) {
  startBot();
  console.log('🤖 Discord bot starting...');
}

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🚀 AccessGrantedSportz backend is live!`);
  console.log(`📡 Auth routes:       /api/auth/register, /api/auth/login`);
  console.log(`📡 League routes:     /api/leagues`);
  console.log(`📡 Team routes:       /api/leagues/:leagueId/teams`);
  console.log(`📡 Player routes:     /api/leagues/:leagueId/players`);
  console.log(`📡 Game routes:       /api/leagues/:leagueId/games`);
  console.log(`📡 Trade routes:      /api/leagues/:leagueId/trades`);
  console.log(`📡 Awards routes:     /api/leagues/:leagueId/awards`);
  console.log(`📡 Ingestion routes:  /api/ingest/madden/:leagueId`);
  console.log(`📡 Storyline routes:  /api/leagues/:leagueId/storylines`);
  console.log(`📡 Invite routes:     /api/invites, /api/leagues/:leagueId/invites`);
  console.log(`🤖 Discord: /rankings /rumors /scout /standings /gems /leaders /value /compare /awards /recap /scores /tradecheck /invite`);
  
});

export default app;