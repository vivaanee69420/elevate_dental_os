"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const auth_service_1 = require("../services/auth.service");
const auth_model_1 = require("../models/auth.model");
exports.authController = {
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
            permissions: req.user.permissions,
        });
    },
    async invite(req, res) {
        const body = auth_model_1.inviteSchema.parse(req.body);
        res.json(await auth_service_1.authService.invite(req.user.organisation_id, body));
    },
};
