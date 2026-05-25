// ============================================================================
// Training routes — library, mentorship, one-to-ones, "my training" feed.
// Placeholder until training-content service spins up.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
const router = (0, express_1.Router)();

const LIBRARY = [
    { id: 'tx-1', title: 'Implant case selection', category: 'Clinical', duration_min: 45 },
    { id: 'tx-2', title: 'Reception telephone triage', category: 'Front-of-house', duration_min: 30 },
    { id: 'tx-3', title: 'TCO consultation framework', category: 'Sales', duration_min: 60 },
];

router.get('/library', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    res.json({ courses: LIBRARY });
}));

router.get('/my', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({ user_id: req.user.id, enrolments: [], completed: [] });
}));

router.get('/mentorship', (0, async_handler_1.asyncHandler)(async (_req, res) => {
    res.json({ programmes: [] });
}));

router.get('/one-to-one', (0, async_handler_1.asyncHandler)(async (req, res) => {
    res.json({ user_id: req.user.id, sessions: [] });
}));

export default router;
