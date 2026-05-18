"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthController = void 0;
exports.healthController = {
    async check(_req, res) {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: process.env.APP_VERSION || 'dev',
        });
    },
};
