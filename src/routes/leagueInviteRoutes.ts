import { Router } from 'express';
import {
  create,
  getAll,
  getMembers,
  deactivate
} from '../controllers/inviteController';
import { protect } from '../middleware/authMiddleware';

const router = Router({ mergeParams: true });

router.use(protect);

// POST /api/leagues/:leagueId/invites
router.post('/',                        create);

// GET /api/leagues/:leagueId/invites
router.get('/',                         getAll);

// GET /api/leagues/:leagueId/members
router.get('/members',                  getMembers);

// DELETE /api/leagues/:leagueId/invites/:inviteId
router.delete('/:inviteId',             deactivate);

export default router;