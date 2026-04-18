import { Router } from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID!;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET!;
const BACKEND_URL           = process.env.BACKEND_URL ||
  'https://accessgrantedsportz-backend-production.up.railway.app';
const FRONTEND_URL          = process.env.FRONTEND_URL ||
  'https://accessgrantedsportz.com';
const REDIRECT_URI          = `${BACKEND_URL}/api/auth/discord/callback`;

// =============================================
// DISCORD OAUTH — Redirect to Discord
// GET /api/auth/discord?invite_code=XXXX
// =============================================
router.get('/discord', (req: any, res: any) => {
  const inviteCode = req.query.invite_code || '';

  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         'identify email',
    state:         inviteCode as string
  });

  res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`
  );
});

// =============================================
// DISCORD OAUTH — Callback from Discord
// GET /api/auth/discord/callback
// =============================================
router.get('/discord/callback', async (req: any, res: any) => {
  try {
    const code       = req.query.code as string;
    const inviteCode = req.query.state as string;

    if (!code) {
      res.redirect(`${FRONTEND_URL}/invite/${inviteCode}?error=cancelled`);
      return;
    }

    // Exchange code for access token
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get Discord user info
    const userResponse = await axios.get(
      'https://discord.com/api/users/@me',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const discordUser = userResponse.data;

    // Check if user already exists
    let userResult = await query(
      `SELECT * FROM users WHERE discord_user_id = $1`,
      [discordUser.id]
    );

    let userId: string;

    if (userResult.rows.length > 0) {
      // Update existing user
      userId = userResult.rows[0].id;
      await query(
        `UPDATE users SET
          discord_username = $1,
          updated_at       = NOW()
         WHERE id = $2`,
        [discordUser.username, userId]
      );
    } else {
      // Create new user
      userId = uuidv4();
      await query(
        `INSERT INTO users (
          id, username, email,
          password_hash,
          discord_user_id,
          discord_username
        )
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          discordUser.username,
          discordUser.email || `${discordUser.id}@discord.ags`,
          'discord_oauth',
          discordUser.id,
          discordUser.username
        ]
      );
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: userId },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    // Redirect back to invite page with token
    res.redirect(
      `${FRONTEND_URL}/invite/${inviteCode}?token=${token}&discord_id=${discordUser.id}&username=${discordUser.username}`
    );

  } catch (error) {
    console.error('Discord OAuth error:', error);
    res.redirect(`${FRONTEND_URL}?error=auth_failed`);
  }
});

export default router;