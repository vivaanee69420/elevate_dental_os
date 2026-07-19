import { dailyReportSettingsSchema } from "../models/daily-report.model.js";
import { dailyReportService } from "../services/daily-report.service.js";
import { whatsappReportRepository } from "../repositories/whatsapp-report.repository.js";

// Manual sends go to the owner's WhatsApp. In-memory per-process limiter:
// good enough to stop an accidental double-click storm, and deliberately not
// a distributed limiter — this is a convenience guard, not a security control.
const MAX_MANUAL_SENDS_PER_HOUR = 6;
const WINDOW_MS = 60 * 60 * 1000;
const sendLog = new Map(); // orgId -> number[] (timestamps)

export function _resetSendLimiter() { sendLog.clear(); }

function allowSend(orgId, nowMs) {
    const recent = (sendLog.get(orgId) ?? []).filter((t) => nowMs - t < WINDOW_MS);
    if (recent.length >= MAX_MANUAL_SENDS_PER_HOUR) {
        sendLog.set(orgId, recent);
        return false;
    }
    recent.push(nowMs);
    sendLog.set(orgId, recent);
    return true;
}

// Never return the raw URL — it is a send-anything credential.
function mask(url) {
    if (!url) return null;
    return url.length <= 12 ? '********' : `${url.slice(0, 8)}********${url.slice(-4)}`;
}

function present(settings) {
    if (!settings) return null;
    return {
        webhookUrlMasked: mask(settings.webhookUrl),
        configured: Boolean(settings.webhookUrl),
        enabled: settings.enabled,
        lastSentAt: settings.lastSentAt,
        lastStatus: settings.lastStatus,
        lastError: settings.lastError,
    };
}

export const dailyReportController = {
    async getSettings(req, res) {
        const settings = await whatsappReportRepository.get(req.user.organisation_id);
        return res.json({ settings: present(settings) });
    },

    async saveSettings(req, res) {
        const parsed = dailyReportSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' });
        }
        const settings = await whatsappReportRepository.upsert(req.user.organisation_id, parsed.data);
        return res.json({ settings: present(settings) });
    },

    async preview(req, res) {
        let line;
        let payload;
        try {
            ({ line, payload } = await dailyReportService.buildPayload(req.user.organisation_id, {}));
        } catch (err) {
            console.error(`[daily-report] preview buildPayload failed for ${req.user.organisation_id}`, err);
            return res.status(503).json({ error: 'Could not build the preview: ad performance data is unavailable.' });
        }
        return res.json({ line, length: line.length, payload });
    },

    // NOTE: no third parameter. Express always passes `next` as the third
    // argument (asyncHandler forwards it), so a `deps = ...` default would
    // never apply and `deps` would be `next` at runtime. Tests stub the
    // service by spying on the module, exactly as `preview` above does.
    async send(req, res) {
        const orgId = req.user.organisation_id;
        if (!allowSend(orgId, Date.now())) {
            return res.status(429).json({ error: 'Too many manual sends. Try again later.' });
        }
        const result = await dailyReportService.send(orgId, { trigger: 'manual' });
        return res.json(result);
    },
};
