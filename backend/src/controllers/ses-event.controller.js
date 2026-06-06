// ============================================================================
// SES event webhook — receives SES delivery notifications via an SNS topic.
// PUBLIC route; security is the SNS signature check (lib/aws-sns).
// Raw body parser mounted on /webhooks/ses-events in app.js.
// ============================================================================
import { verifySnsSignature, confirmSubscription } from "../lib/aws-sns.js";
import { notificationRepository } from "../repositories/notification.repository.js";
import * as supabase_1 from "../lib/supabase.js";

async function logProviderEvent(provider, external_id, event_type, payload) {
    try {
        await supabase_1.serviceClient.from('provider_events').insert({
            organisation_id: null, provider, external_id, event_type, payload,
        });
    } catch (err) {
        console.warn('[ses-event] provider_events log failed', err);
    }
}

export const sesEventController = {
    async handle(req, res) {
        let msg;
        try {
            msg = JSON.parse(req.body.toString('utf8'));
        } catch {
            return res.status(400).json({ error: 'bad json' });
        }
        const valid = await verifySnsSignature(msg);
        if (!valid) return res.status(403).json({ error: 'bad signature' });

        if (msg.Type === 'SubscriptionConfirmation') {
            await confirmSubscription(msg.SubscribeURL);
            return res.json({ ok: true, confirmed: true });
        }

        if (msg.Type === 'Notification') {
            let event;
            try { event = JSON.parse(msg.Message); } catch { event = {}; }
            const now = new Date().toISOString();
            const type = event.eventType || event.notificationType; // SES uses both shapes
            if (type === 'Bounce' && event.bounce?.bounceType === 'Permanent') {
                for (const r of event.bounce.bouncedRecipients || []) {
                    await notificationRepository.upsertSuppression(r.emailAddress, 'bounce', now);
                    await logProviderEvent('ses', event.mail?.messageId, 'bounce', { address: r.emailAddress });
                }
            } else if (type === 'Complaint') {
                for (const r of event.complaint?.complainedRecipients || []) {
                    await notificationRepository.upsertSuppression(r.emailAddress, 'complaint', now);
                    await logProviderEvent('ses', event.mail?.messageId, 'complaint', { address: r.emailAddress });
                }
            } else if (type === 'Delivery') {
                await logProviderEvent('ses', event.mail?.messageId, 'delivered', {});
            }
            return res.json({ ok: true });
        }
        return res.json({ ok: true });
    },
};
