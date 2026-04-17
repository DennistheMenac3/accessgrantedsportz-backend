import { Router } from 'express';
import { register, login, getMe } from '../controllers/authController';
import { protect } from '../middleware/authMiddleware';

// Router is like a mini Express app
// just for this group of routes
const router = Router();

// Public routes — no token needed
// POST /api/auth/register
router.post('/register', register);

// POST /api/auth/login
router.post('/login', login);

// Protected route — token required
// GET /api/auth/me
// protect runs first, then getMe
router.get('/me', protect, getMe);

export default router;