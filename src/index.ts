import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import pool from './config/database';

dotenv.config();

// Import routes
import authRoutes from './routes/authRoutes';
import discordAuthRoutes from './routes/discordAuthRoutes';
import stripeRoutes from './routes/stripeRoutes';
import leagueRoutes from './routes/leagueRoutes';
import teamRoutes from './routes/teamRoutes';
import playerRoutes from './routes/playerRoutes';
import gameRoutes from './routes/gameRoutes';
import tradeRoutes from './routes/tradeRoutes';
import awardsRoutes from './routes/awardsRoutes';
import ingestionRoutes from './routes/ingestionRoutes';
import storylineRoutes from './routes/storylineRoutes';
import inviteRoutes from './routes/inviteRoutes';
import leagueInviteRoutes from './routes/leagueInviteRoutes';
import communityRoutes from './routes/communityRoutes';

import { startBot, commands } from './discord/bot';
import { startScheduler } from './services/schedulerService';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// =============================================
// 1. STRIPE WEBHOOK (Must be before JSON parser)
// =============================================
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  (stripeRoutes as any).handle(req, res, next);
});

// =============================================
// 2. CRITICAL: PAYLOAD LIMITS (Top of Middleware)
// =============================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false })); // Helps with some image hosting issues
app.use(morgan('dev'));

// =============================================
// 3. API ROUTES
// =============================================
app.use('/api/auth', authRoutes);
app.use('/api/auth', discordAuthRoutes);
app.use('/api/stripe', stripeRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/leagues/:leagueId/teams', teamRoutes);
app.use('/api/leagues/:leagueId/players', playerRoutes);
app.use('/api/leagues/:leagueId/games', gameRoutes);
app.use('/api/leagues/:leagueId/trades', tradeRoutes);
app.use('/api/leagues/:leagueId/awards', awardsRoutes);
app.use('/api/ingest', ingestionRoutes);
app.use('/api/leagues/:leagueId/storylines', storylineRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/leagues/:leagueId/invites', leagueInviteRoutes);
app.use('/api/community', communityRoutes);

app.get('/', (req, res) => res.json({ status: 'AccessGrantedSportz API Live' }));

startScheduler();
if (process.env.DISCORD_BOT_TOKEN) startBot();

app.listen(PORT, () => console.log(`🚀 Backend live on port ${PORT}`));

export default app;