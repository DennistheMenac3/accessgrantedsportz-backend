import { Router } from 'express';
import {
  create,
  validate,
  join,
  getAll,
  getMembers,
  deactivate
} from '../controllers/inviteController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

// =============================================
// PUBLIC ROUTES — No auth needed
// =============================================

// GET /api/invites/:code
// Validate invite and show league info
router.get('/:code', validate);

// POST /api/invites/:code/join
// Join a league with invite code
router.post('/:code/join', protect, join);

export default router;