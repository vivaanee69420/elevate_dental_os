"use strict";
// ============================================================================
// ELEVATE DENTAL OS — Backend API Server (Express)
// ============================================================================
// Express + TypeScript + Supabase + Zod
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = void 0;
const app_1 = require("./app");
Object.defineProperty(exports, "buildApp", { enumerable: true, get: function () { return app_1.buildApp; } });
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
function start() {
    try {
        const app = (0, app_1.buildApp)();
        const server = app.listen(PORT, HOST, () => {
            console.log(`✓ Elevate API listening on ${HOST}:${PORT}`);
        });
        server.requestTimeout = 30000;
    }
    catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}
start();
