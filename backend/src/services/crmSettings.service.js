// ============================================================================
// CRM settings service — config store + aggregator. GET seeds the org's row
// from the catalogue defaults on first read (no row yet), then returns the
// settings plus live counts (templates, active sequences, treatments, sources).
// Treatment values are integer PENCE.
// ============================================================================
import * as crmSettings_repository_1 from "../repositories/crmSettings.repository.js";
import * as errors_1 from "../middleware/errors.js";

// First-read defaults — mirrors frontend/features/crm/data.ts (whole-pound
// TREATMENT_VALUES converted to pence). Persisted on first GET so later edits
// are diffs against a real row.
export const DEFAULT_SETTINGS = {
    treatments: [
        { name: 'All-on-4 Implants', default_value_pence: 1450000 },
        { name: 'Single Tooth Implant', default_value_pence: 285000 },
        { name: 'Invisalign', default_value_pence: 350000 },
        { name: 'Composite Bonding', default_value_pence: 120000 },
        { name: 'Porcelain Veneers', default_value_pence: 240000 },
        { name: 'Teeth Whitening', default_value_pence: 45000 },
    ],
    sources: ['Website Form', 'Meta Lead Ad', 'Google Ads', 'Patient Referral', 'Phone Enquiry'],
    payment_plans: ['Pay upfront', 'Practice Finance 12m', 'Practice Finance 24m', 'Tabeo 24m', 'Medenta 36m'],
    gdpr_default_basis: 'legitimate_interest',
    quiet_hours_start: '21:00',
    quiet_hours_end: '08:00',
    quiet_hours_tz: 'Europe/London',
    marketing_default_consent: false,
};

async function counts(orgId, settings) {
    const [template_count, active_sequence_count] = await Promise.all([
        crmSettings_repository_1.crmSettingsRepository.templateCount(orgId),
        crmSettings_repository_1.crmSettingsRepository.activeSequenceCount(orgId),
    ]);
    return {
        template_count,
        active_sequence_count,
        treatment_count: (settings.treatments || []).length,
        source_count: (settings.sources || []).length,
    };
}

export const crmSettingsService = {
    async get(orgId) {
        let settings = await crmSettings_repository_1.crmSettingsRepository.get(orgId);
        if (!settings) {
            const { data, error } = await crmSettings_repository_1.crmSettingsRepository.upsert(orgId, DEFAULT_SETTINGS);
            if (error) throw new errors_1.AppError(error.message, 400);
            settings = data;
        }
        return { settings, counts: await counts(orgId, settings) };
    },
    async update(orgId, userId, patch) {
        const { data, error } = await crmSettings_repository_1.crmSettingsRepository.upsert(orgId, {
            updated_by: userId,
            ...patch,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        return { settings: data, counts: await counts(orgId, data) };
    },
};
