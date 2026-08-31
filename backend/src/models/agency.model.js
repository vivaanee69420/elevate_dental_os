// Agency menu request schemas (Zod). FEATURE_KEYS bounds the toggle enum so a
// typo'd key can never create a stray org_features row.
import * as zod_1 from "zod";
import { FEATURE_KEYS } from "../lib/features.js";

// Creating a sub-account makes the ORGANISATION only — no owner, no temporary
// password. Users are added afterwards with a permanent password the agency
// sets, so nothing has to be handed over out of band.
export const createSubaccountSchema = zod_1.z.object({
    organisation_name: zod_1.z.string().trim().min(2).max(120),
});

// A user added to a sub-account. They belong to that org and only that org —
// users.organisation_id is single-valued, so isolation is structural.
export const subaccountUserSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email(),
    full_name: zod_1.z.string().trim().min(1).max(120),
    password: zod_1.z.string().min(8).max(200),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception']).default('owner'),
});

// Deleting a sub-account cascades its entire dataset, so the caller must echo
// the organisation's name back.
export const deleteSubaccountSchema = zod_1.z.object({
    confirm_name: zod_1.z.string().trim().min(1),
});

export const switchSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid(),
});

export const featureToggleSchema = zod_1.z.object({
    feature: zod_1.z.enum(FEATURE_KEYS),
    enabled: zod_1.z.boolean(),
});
