// ============================================================================
// ELEVATE DENTAL OS — Backend API Server (Express, native ESM)
// ============================================================================
// Deploy to Railway. ENV vars set via Railway dashboard.
// ============================================================================
// Sentry must load before app/route modules so it can instrument them.
import "./instrument.js";
import { buildApp } from "./app.js";
import { serviceClient } from "./lib/supabase.js";
import { bootstrapPlatformAdmin } from "./lib/platform-admin-bootstrap.js";
import { logger } from "./lib/logger.js";

export { buildApp };

// Last-resort crash capture. Without these, a fatal lands only on stderr and
// is lost when the container restarts. logger.fatal/error routes into
// error.<date>.log (when LOG_DIR is set); the short delay gives the rotating
// file transport a tick to flush before the process exits.
function installCrashHandlers() {
    process.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'uncaughtException — shutting down');
        setTimeout(() => process.exit(1), 250);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error({ err: reason }, 'unhandledRejection');
    });
}
installCrashHandlers();

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
            bootstrapPlatformAdmin();
        });
        server.requestTimeout = 30000;
    }
    catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
// Reload triggered to apply Gemini environment configuration.


