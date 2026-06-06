// ============================================================================
// Notification routes — Express Router. Mounted at /api/notifications.
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as notification_controller_1 from "../controllers/notification.controller.js";
const router = (0, express_1.Router)();
const h = async_handler_1.asyncHandler;
const c = notification_controller_1.notificationController;
router.get('/', h(c.list));
router.get('/unread-count', h(c.unreadCount));
router.get('/preferences', h(c.getPreferences));
router.put('/preferences', h(c.updatePreferences));
router.post('/read-all', h(c.markAllRead));
router.post('/:id/read', h(c.markRead));
export default router;
