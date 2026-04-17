import { Router } from 'express';
import { 
  create, 
  getAll, 
  getOne, 
  update, 
  remove 
} from '../controllers/leagueController';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// All league routes are protected
// protect middleware runs before every route
router.use(protect);

// POST /api/leagues
router.post('/', create);

// GET /api/leagues
router.get('/', getAll);

// GET /api/leagues/:id
router.get('/:id', getOne);

// PUT /api/leagues/:id
router.put('/:id', update);

// DELETE /api/leagues/:id
router.delete('/:id', remove);

export default router;