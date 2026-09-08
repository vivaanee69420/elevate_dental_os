import { practitionerScheduleService } from "../services/practitioner-schedule.service.js";
import {
    scheduleOverviewQuerySchema, saveWeekSchema, saveOverrideSchema,
} from "../models/practitioner-schedule.model.js";

/** N days back as YYYY-MM-DD, at midday so a DST shift cannot move the date. */
function daysAgo(n) {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}

export const practitionerScheduleController = {
    async overview(req, res) {
        const q = scheduleOverviewQuerySchema.parse(req.query);
        res.json(await practitionerScheduleService.overview(req.user.organisation_id, {
            observedSince: q.observed_since ?? daysAgo(90),
            observedUntil: q.observed_until ?? daysAgo(0),
        }));
    },

    async saveWeek(req, res) {
        const body = saveWeekSchema.parse(req.body);
        res.json({
            days: await practitionerScheduleService.saveWeek(
                req.user.organisation_id, body.practitioner_id, body.days, req.user.id,
            ),
        });
    },

    async saveOverride(req, res) {
        const body = saveOverrideSchema.parse(req.body);
        res.json({
            override: await practitionerScheduleService.saveOverride(
                req.user.organisation_id, body.practitioner_id, body.day, body.override, req.user.id,
            ),
        });
    },

    async overrides(req, res) {
        const q = scheduleOverviewQuerySchema.parse(req.query);
        res.json({
            overrides: await practitionerScheduleService.overrides(req.user.organisation_id, {
                since: q.observed_since ?? daysAgo(30),
                until: q.observed_until ?? daysAgo(-60),   // includes the near future
            }),
        });
    },
};
