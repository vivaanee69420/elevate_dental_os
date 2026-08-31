import * as auth_service_1 from "../services/auth.service.js";
import * as auth_model_1 from "../models/auth.model.js";
import * as features_service_1 from "../services/features.service.js";
export const authController = {
    async signup(req, res) {
        const body = auth_model_1.signupSchema.parse(req.body);
        res.json(await auth_service_1.authService.signup(body));
    },
    async login(req, res) {
        const body = auth_model_1.loginSchema.parse(req.body);
        res.json(await auth_service_1.authService.login(body));
    },
    async me(req, res) {
        res.json({
            id: req.user.id,
            email: req.user.email,
            role: req.user.role,
            organisation_id: req.user.organisation_id,
            organisation_name: await auth_service_1.authService.organisationName(req.user.organisation_id),
            permissions: req.user.permissions,
            // Org-level entitlements (agency model) — drives nav/page gating.
            features: await features_service_1.featuresService.enabledKeys(req.user.organisation_id),
            // Frontend hides the email-invite mode until delivery is wired.
            invite_enabled: process.env.TEAM_INVITE_ENABLED === 'true',
        });
    },
    async invite(req, res) {
        const body = auth_model_1.inviteSchema.parse(req.body);
        res.json(await auth_service_1.authService.invite(req.user.organisation_id, req.user, body));
    },
};
