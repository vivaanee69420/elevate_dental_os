// ============================================================================
// Payments routes — Express Router. Mounted at /api/payments (auth upstream).
// ============================================================================
import * as express_1 from "express";
import * as async_handler_1 from "../middleware/async-handler.js";
import * as payment_controller_1 from "../controllers/payment.controller.js";
const router = (0, express_1.Router)();
router.get('/', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.list));
router.get('/source-breakdown', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.sourceBreakdown));
router.post('/', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.createManual));
router.post('/create-payment-link', (0, async_handler_1.asyncHandler)(payment_controller_1.paymentController.createPaymentLink));
export default router;
