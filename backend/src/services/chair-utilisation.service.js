// ============================================================================
// Chair utilisation service — CRUD + heatmap grid aggregation.
// ============================================================================
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { aggregateGrid } from "../lib/chair-utilisation.js";
import * as errors_1 from "../middleware/errors.js";

const todayStr = () => new Date().toISOString().split('T')[0];

// History (000055): snapshot the practice's full current cell set after any
// change, so a past period can replay the grid as it was. Best-effort — a
// snapshot failure must not fail the user's write.
async function captureGrid(orgId, practiceId) {
    if (!practiceId) return;
    const rows = await chairUtilisationRepository.list(orgId, practiceId);
    const cells = rows.map((r) => ({
        chair_name: r.chair_name, weekday: r.weekday, slot: r.slot,
        booked_minutes: r.booked_minutes, available_minutes: r.available_minutes,
    }));
    await chairUtilisationRepository.upsertSnapshot(orgId, practiceId, todayStr(), cells);
}

export const chairUtilisationService = {
    list(orgId, practiceId) {
        return chairUtilisationRepository.list(orgId, practiceId);
    },

    async grid(orgId, practiceId, { asOf = null } = {}) {
        // As-of read: replay the historical grid (per-practice only).
        if (asOf && practiceId) {
            const cells = await chairUtilisationRepository.getSnapshotAsOf(orgId, practiceId, asOf);
            return aggregateGrid(cells || []);
        }
        const records = await chairUtilisationRepository.list(orgId, practiceId);
        return aggregateGrid(records);
    },

    async create(orgId, input) {
        const { data, error } = await chairUtilisationRepository.create({
            organisation_id: orgId,
            ...input,
        });
        if (error) throw new errors_1.AppError(error.message, 400);
        await captureGrid(orgId, data?.practice_id ?? input.practice_id);
        return data;
    },

    async update(orgId, id, patch) {
        const { data, error } = await chairUtilisationRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        await captureGrid(orgId, data.practice_id);
        return data;
    },

    async remove(orgId, id) {
        const { data, error } = await chairUtilisationRepository.remove(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Record not found', 404);
        await captureGrid(orgId, data.practice_id);
        return { ok: true };
    },
};
