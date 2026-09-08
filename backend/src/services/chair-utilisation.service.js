// ============================================================================
// Chair utilisation service — chairs, opening hours, and whole-week saves.
//
// The per-record create/update/delete path this replaces keyed a cell by
// free-text chair name and fired a full snapshot rewrite per cell, so saving a
// 56-cell week meant 56 list-and-rewrite cycles. That is why nine cells exist
// across the whole platform.
// ============================================================================
import { chairUtilisationRepository } from "../repositories/chair-utilisation.repository.js";
import { practiceChairRepository } from "../repositories/practice-chair.repository.js";
import { practiceOpeningHoursRepository } from "../repositories/practice-opening-hours.repository.js";
import { chairCapacityService } from "./chair-capacity.service.js";
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
        chair_id: r.chair_id, chair_name: r.chair_name, weekday: r.weekday, slot: r.slot,
        booked_minutes: r.booked_minutes, available_minutes: r.available_minutes,
        revenue_pence: r.revenue_pence ?? 0,
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

    /** The editable week: chairs, derived availability, entered booked time. */
    week(orgId, practiceId) {
        return chairCapacityService.practiceWeek(orgId, practiceId);
    },

    async listChairs(orgId, practiceId) {
        return { chairs: await practiceChairRepository.listForPractice(orgId, practiceId) };
    },

    async createChair(orgId, input) {
        const { data, error } = await practiceChairRepository.create(orgId, input);
        if (error) {
            // The normalised-name unique index is what stops "Surgery 1" and
            // "Surgery 1 " becoming two chairs and doubling capacity. Say that
            // in words rather than surfacing a Postgres constraint name.
            const conflict = /duplicate key|unique constraint/i.test(error.message);
            throw new errors_1.AppError(
                conflict ? 'A chair with that name already exists at this practice' : error.message,
                conflict ? 409 : 400,
            );
        }
        return data;
    },

    async updateChair(orgId, id, patch) {
        const { data, error } = await practiceChairRepository.update(orgId, id, patch);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Chair not found', 404);
        return data;
    },

    async removeChair(orgId, id) {
        const { data, error } = await practiceChairRepository.remove(orgId, id);
        if (error) throw new errors_1.AppError(error.message, 400);
        if (!data) throw new errors_1.AppError('Chair not found', 404);
        await captureGrid(orgId, data.practice_id);
        return { ok: true };
    },

    async listOpeningHours(orgId, practiceId) {
        return { days: await practiceOpeningHoursRepository.listForPractice(orgId, practiceId) };
    },

    async saveOpeningHours(orgId, { practice_id, days }) {
        // Hand-edited hours are stamped 'manual' so the Dentally sync leaves
        // them alone for ever after. An owner's correction must not be undone
        // by tonight's sync.
        const saved = await practiceOpeningHoursRepository.upsertWeek(orgId, practice_id, days, 'manual');
        return { days: saved };
    },

    /** One chair's whole week, one statement, ONE snapshot. */
    async saveWeek(orgId, { practice_id, chair_id, cells }) {
        // The chair must belong to this organisation AND this practice. The id
        // arrives in the request body, so without this check a caller could
        // name another tenant's chair and write cells against it.
        const chairs = await practiceChairRepository.listForPractice(orgId, practice_id);
        const chair = chairs.find((c) => c.id === chair_id);
        if (!chair) throw new errors_1.AppError('Chair not found at this practice', 404);

        const saved = await chairUtilisationRepository.bulkUpsertChairWeek(orgId, {
            practice_id, chair_id, chair_name: chair.name, cells,
        });
        // ONE snapshot for the whole save.
        await captureGrid(orgId, practice_id);
        return { saved: saved.length };
    },
};
