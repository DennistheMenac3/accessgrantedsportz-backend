import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pool from './config/database';

dotenv.config();

// Import routes
import authRoutes         from './routes/authRoutes';
import discordAuthRoutes  from './routes/discordAuthRoutes';
import stripeRoutes       from './routes/stripeRoutes';
import leagueRoutes       from './routes/leagueRoutes';
import teamRoutes         from './routes/teamRoutes';
import playerRoutes       from './routes/playerRoutes';
import gameRoutes         from './routes/gameRoutes';
import tradeRoutes        from './routes/tradeRoutes';
import awardsRoutes       from './routes/awardsRoutes';
import ingestionRoutes    from './routes/ingestionRoutes';
import storylineRoutes    from './routes/storylineRoutes';
import inviteRoutes       from './routes/inviteRoutes';
import leagueInviteRoutes from './routes/leagueInviteRoutes';
import communityRoutes    from './routes/communityRoutes';

// Import Bot & Scheduler
import { startBot, commands } from './discord/bot';
import { startScheduler }     from './services/schedulerService';

// =============================================
// DISCORD COMMAND IMPORTS
// =============================================
// Standard Commands
import { data as rankingsCmd, execute as rankingsExec } from './discord/commands/rankings';
import { data as rumorsCmd, execute as rumorsExec } from './discord/commands/rumors';
import { data as standingsCmd, execute as standingsExec } from './discord/commands/standings';
import { data as gemsCmd, execute as gemsExec } from './discord/commands/gems';
import { data as leadersCmd, execute as leadersExec } from './discord/commands/leaders';
import { data as awardsCmd, execute as awardsExec } from './discord/commands/awards';
import { data as recapCmd, execute as recapExec } from './discord/commands/recap';
import { data as inviteCmd, execute as inviteExec } from './discord/commands/invite';
import { data as scoresCmd, execute as scoresExec } from './discord/commands/scores';
import { data as joinCmd, execute as joinExec } from './discord/commands/join';
import { data as claimCmd, execute as claimExec } from './discord/commands/claim';
import { data as tradeCmd, execute as tradeExec } from './discord/commands/trade';
import { data as teamCmd, execute as teamExec } from './discord/commands/team'; // Restored!
import { data as valueCmd, execute as valueExec } from './discord/commands/value';
import { data as compareCmd, execute as compareExec } from './discord/commands/compare';
import { data as scoutCmd, execute as scoutExec } from './discord/commands/scout';
import { data as tradecheckCmd, execute as tradecheckExec } from './discord/commands/tradecheck';

// Commands with Autocomplete
import { data as playerCmd, execute as playerExec, autocomplete as playerAutocomplete } from './discord/commands/player';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// =============================================
// 1. STRIPE WEBHOOK (Must be before JSON parser)
// =============================================
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    (stripeRoutes as any).handle(req, res, next);
  }
);

// =============================================
// 2. MIDDLEWARE
// =============================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({
  origin: [
    'http://localhost:5173',               // Let your local dev machine in
    'https://accessgrantedsportz.com',     // Let your live website in
    'https://www.accessgrantedsportz.com'  // Let the 'www' version in just in case
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));

// =============================================
// 3. API ROUTES
// =============================================

// -> NEW GLOBAL PLAYER ROUTE ADDED HERE <-
app.get('/api/players/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const playerId = req.params.id;
    
    // Use your existing 'pool' connection to find the player
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Send the player data to the frontend
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching player by ID:', error);
    return res.status(500).json({ error: 'Database error' });
  }
});

app.use('/api/auth',                         authRoutes);
app.use('/api/auth',                         discordAuthRoutes);
app.use('/api/stripe',                       stripeRoutes);
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
app.use('/api/community',                    communityRoutes);

app.get('/', (_req, res) =>
  res.json({ status: 'AccessGrantedSportz API Live' })
);

// =============================================
// 4. REGISTER DISCORD COMMANDS
// =============================================

// Standard commands
commands.set(rankingsCmd.name,  { execute: rankingsExec  });
commands.set(rumorsCmd.name,    { execute: rumorsExec    });
commands.set(standingsCmd.name, { execute: standingsExec });
commands.set(gemsCmd.name,      { execute: gemsExec      });
commands.set(leadersCmd.name,   { execute: leadersExec   });
commands.set(awardsCmd.name,    { execute: awardsExec    });
commands.set(recapCmd.name,     { execute: recapExec     });
commands.set(inviteCmd.name,    { execute: inviteExec    });
commands.set(scoresCmd.name,    { execute: scoresExec    });
commands.set(joinCmd.name,      { execute: joinExec      });
commands.set(claimCmd.name,     { execute: claimExec     });
commands.set(tradeCmd.name,     { execute: tradeExec     });
commands.set(teamCmd.name,      { execute: teamExec      }); // Restored!
commands.set(valueCmd.name,     { execute: valueExec     });
commands.set(compareCmd.name,   { execute: compareExec   });
commands.set(scoutCmd.name,     { execute: scoutExec     });
commands.set(tradecheckCmd.name,{ execute: tradecheckExec});

// Commands with autocomplete
commands.set(playerCmd.name, {
  execute:      playerExec,
  autocomplete: playerAutocomplete
});

// =============================================
// 5. START SERVICES
// =============================================
startScheduler();

if (process.env.DISCORD_BOT_TOKEN) {
  startBot();
  console.log('🤖 Discord bot starting...');
}

app.listen(PORT, () =>
  console.log(`🚀 Backend live on port ${PORT}`)
);

export default app;