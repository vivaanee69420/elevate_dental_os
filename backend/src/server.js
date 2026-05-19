"use strict";
// ============================================================================
// ELEVATE DENTAL OS — Backend API Server (Express)
// ============================================================================
// Express + TypeScript + Supabase + Zod
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = void 0;
// Sentry must load before app/route modules so it can instrument them.
require("./instrument");
const app_1 = require("./app");
const supabase_1 = require("./lib/supabase");
Object.defineProperty(exports, "buildApp", { enumerable: true, get: function () { return app_1.buildApp; } });
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';
async function checkSupabase() {
    try {
        const { error } = await supabase_1.serviceClient
            .from('users')
            .select('id', { count: 'exact', head: true });
        if (error)
            throw error;
        console.log(`✓ Supabase connected (${process.env.SUPABASE_URL})`);
    }
    catch (err) {
        console.error(`✗ Supabase connection FAILED: ${err.message || err}`);
    }
}
function start() {
    try {
        const app = (0, app_1.buildApp)();
        const server = app.listen(PORT, HOST, () => {
            console.log(`✓ Elevate API listening on ${HOST}:${PORT}`);
            checkSupabase();
        });
        server.requestTimeout = 30000;
    }
    catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}
start();
