// ============================================================================
// ELEVATE DENTAL OS — Backend API Server (Express, native ESM)
// ============================================================================
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
// Sentry must load before app/route modules so it can instrument them.
import "./instrument.js";
import { buildApp } from "./app.js";
import { serviceClient } from "./lib/supabase.js";

export { buildApp };

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = '0.0.0.0';

async function checkSupabase() {
    try {
        const { error } = await serviceClient
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
        const app = buildApp();
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
