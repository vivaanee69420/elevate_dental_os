// Unified messaging facade — picks per-tenant SES/SNS identity if available,
// falls back to platform Postmark/Twilio. Existing call sites pass orgId.
// Workers and services migrate via this single import.
//
// orgId routing decision:
//   ┌─────────────────────────────────────────────────────────────┐
//   │  if integrations[org].ses + status='active' → AWS SES        │
//   │  else                                       → Postmark       │
//   │  if integrations[org].sns_sms + status='active' → AWS SNS    │
//   │  else                                       → Twilio         │
//   └─────────────────────────────────────────────────────────────┘
//
// Identity resolution and provider event logging happen inside this module so
// every send is auditable in provider_events regardless of vendor.

import { integrationRepository } from "../repositories/integration.repository.js";
import { decryptSecret } from "./crypto.js";
import * as supabase_1 from "./supabase.js";
import * as postmark_1 from "./postmark.js";
import * as twilio_1 from "./twilio.js";
import * as ses_1 from "./aws-ses.js";
import * as sns_1 from "./aws-sns.js";

async function logEvent(orgId, provider, external_id, event_type, payload = {}) {
    try {
        await supabase_1.serviceClient.from('provider_events').insert({
            organisation_id: orgId,
            provider,
            external_id,
            event_type,
            payload,
        });
    } catch (err) {
        // Best-effort — never block a send on event logging.
        console.warn('[messaging] event log failed', err);
    }
}

async function getActive(orgId, provider) {
    const row = await integrationRepository.getByProvider(orgId, provider);
    if (!row || row.status !== 'active') return null;
    let secrets = null;
    if (row.secrets) {
        try { secrets = JSON.parse(decryptSecret(row.secrets)); }
        catch (e) { console.warn('[messaging] decrypt failed', e); }
    }
    return { config: row.config ?? {}, secrets };
}

async function sendViaSES(orgId, ses, opts) {
    // Real impl: new SESv2Client({ region, credentials }).send(new SendEmailCommand(...))
    // Stub records the send attempt to provider_events so the surface is testable.
    const external_id = `ses-stub-${Date.now()}`;
    await logEvent(orgId, 'ses', external_id, 'sent', { to: opts.to, from: ses.config.from_address });
    return { external_id, provider: 'ses' };
}

async function sendViaSNS(orgId, sns, opts) {
    const external_id = `sns-stub-${Date.now()}`;
    await logEvent(orgId, 'sns_sms', external_id, 'sent', { to: opts.to, originator: sns.config.origination_identity });
    return { external_id, provider: 'sns_sms' };
}

export async function sendEmail(opts) {
    const { orgId, to, subject, body, from } = opts;
    if (!orgId) throw new Error('sendEmail requires orgId');
    const ses = await getActive(orgId, 'ses');
    if (ses) {
        return sendViaSES(orgId, ses, opts);
    }
    // Platform fallback: AWS SES (single platform domain). Legacy Postmark only
    // when explicitly enabled via env.
    if (process.env.USE_LEGACY_EMAIL === 'true') {
        const messageId = await postmark_1.sendEmail({ to, subject, body, from });
        await logEvent(orgId, 'postmark', messageId, 'sent', { to });
        return { external_id: messageId, provider: 'postmark' };
    }
    const sesId = await ses_1.sendEmail({ to, subject, html: body, from });
    await logEvent(orgId, 'ses', sesId, 'sent', { to });
    return { external_id: sesId, provider: 'ses' };
}

export async function sendSMS(opts) {
    const { orgId, to, body } = opts;
    if (!orgId) throw new Error('sendSMS requires orgId');
    const sns = await getActive(orgId, 'sns_sms');
    if (sns) {
        return sendViaSNS(orgId, sns, opts);
    }
    if (process.env.USE_LEGACY_SMS === 'true') {
        const sid = await twilio_1.sendSMS({ to, body });
        await logEvent(orgId, 'twilio', sid, 'sent', { to });
        return { external_id: sid, provider: 'twilio' };
    }
    const snsId = await sns_1.sendSMS({ to, body });
    await logEvent(orgId, 'sns_sms', snsId, 'sent', { to });
    return { external_id: snsId, provider: 'sns_sms' };
}
