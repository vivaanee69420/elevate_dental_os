import express from 'express';
import { requireRole } from '../middleware/auth.js';
import { getPerformance } from '../controllers/marketing.controller.js';

const router = express.Router();

// Reception is CRM-only (rule 5) and must never reach marketing figures.
router.get('/performance', requireRole('owner', 'practice_manager'), getPerformance);

export default router;
