"use strict";
// ============================================================================
// Background workers — cron jobs
// ============================================================================
// Run as separate Railway service: `node dist/workers/index.js`
// Cron schedules driven by node-cron
// ============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_cron_1 = __importDefault(require("node-cron"));
const supabase_1 = require("../lib/supabase");
const postmark_1 = require("../lib/postmark");
// --------------------------------------------------------------------------
// Monthly business health snapshots — 1st of every month at 02:00 UTC
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 2 1 * *', async () => {
    console.log('[worker] Running monthly snapshot job');
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id')
        .neq('subscription_plan', 'cancelled');
    for (const org of orgs || []) {
        try {
            // Calculate current metrics from live data
            // (in production, query payments, leads, appointments to derive these)
            const { data: health } = await supabase_1.serviceClient
                .from('business_health')
                .select('baseline')
                .eq('organisation_id', org.id)
                .single();
            if (!health)
                continue;
            // For MVP: store current baseline as snapshot (will be replaced with real-time calc)
            await supabase_1.serviceClient.from('business_health_snapshots').insert({
                organisation_id: org.id,
                snapshot_date: new Date().toISOString().split('T')[0],
                label: `Auto-${new Date().toLocaleString('en-GB', { month: 'short', year: 'numeric' })}`,
                metrics: health.baseline,
            });
        }
        catch (err) {
            console.error(`Snapshot failed for org ${org.id}`, err);
        }
    }
    console.log('[worker] Monthly snapshot job complete');
});
// --------------------------------------------------------------------------
// Weekly digest email — Mondays 07:00 UK time
// --------------------------------------------------------------------------
node_cron_1.default.schedule('0 6 * * 1', async () => {
    console.log('[worker] Running weekly digest');
    const { data: orgs } = await supabase_1.serviceClient
        .from('organisations')
        .select('id, name, users(email, full_name, role)')
        .neq('subscription_plan', 'cancelled');
    for (const org of orgs || []) {
        const owners = org.users?.filter((u) => u.role === 'owner') || [];
        for (const owner of owners) {
            try {
                await (0, postmark_1.sendEmail)({
                    to: owner.email,
                    subject: `Your Elevate weekly digest — ${org.name}`,
                    body: `<h2>This week at ${org.name}</h2><p>Hi ${owner.full_name},</p><p>Your weekly business snapshot...</p>`,
                });
            }
            catch (err) {
                console.error(`Weekly digest failed for ${owner.email}`, err);
            }
        }
    }
});
// --------------------------------------------------------------------------
// Workflow runner — every minute, process pending workflow steps
// --------------------------------------------------------------------------
node_cron_1.default.schedule('* * * * *', async () => {
    const { data: runs } = await supabase_1.serviceClient
        .from('workflow_runs')
        .select('*, workflow:workflows(*)')
        .eq('status', 'running')
        .lte('next_step_at', new Date().toISOString())
        .limit(50);
    for (const run of runs || []) {
        try {
            const workflow = run.workflow;
            if (!workflow)
                continue;
            const steps = workflow.steps || [];
            const nextStep = steps[run.current_step];
            if (!nextStep) {
                await supabase_1.serviceClient
                    .from('workflow_runs')
                    .update({ status: 'completed', completed_at: new Date().toISOString() })
                    .eq('id', run.id);
                continue;
            }
            // Execute step (send email, send SMS, wait, etc.)
            if (nextStep.type === 'send_email' && nextStep.template) {
                const { data: contact } = await supabase_1.serviceClient
                    .from('contacts')
                    .select('email, first_name')
                    .eq('id', run.contact_id)
                    .single();
                if (contact?.email) {
                    await (0, postmark_1.sendEmail)({
                        to: contact.email,
                        subject: nextStep.subject || 'Update from us',
                        body: (nextStep.body || '').replace('{{first_name}}', contact.first_name || ''),
                    });
                }
            }
            // Advance to next step
            const delayMs = (nextStep.delay_hours || 0) * 3600000;
            await supabase_1.serviceClient
                .from('workflow_runs')
                .update({
                current_step: run.current_step + 1,
                next_step_at: new Date(Date.now() + delayMs).toISOString(),
            })
                .eq('id', run.id);
        }
        catch (err) {
            console.error(`Workflow run ${run.id} failed`, err);
            await supabase_1.serviceClient
                .from('workflow_runs')
                .update({ status: 'failed' })
                .eq('id', run.id);
        }
    }
});
console.log('[workers] Started — cron schedules active');
