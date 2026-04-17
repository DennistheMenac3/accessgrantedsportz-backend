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
router.get('/:code', validate);

// POST /api/invites/:code/join
router.post('/:code/join', protect, join);

// =============================================
// PROTECTED ROUTES — Auth required
// =============================================

// POST /api/leagues/:leagueId/invites
router.post('/', protect, create);

// GET /api/leagues/:leagueId/invites
router.get('/', protect, getAll);

// GET /api/leagues/:leagueId/members
router.get('/members', protect, getMembers);

// DELETE /api/leagues/:leagueId/invites/:inviteId
router.delete('/:inviteId', protect, deactivate);

export default router;