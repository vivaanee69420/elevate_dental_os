// Agency menu request schemas (Zod). FEATURE_KEYS bounds the toggle enum so a
// typo'd key can never create a stray org_features row.
import * as zod_1 from "zod";
import { FEATURE_KEYS } from "../lib/features.js";

export const createSubaccountSchema = zod_1.z.object({
    organisation_name: zod_1.z.string().trim().min(2).max(120),
    owner_email: zod_1.z.string().trim().email(),
    owner_name: zod_1.z.string().trim().min(1).max(120),
});

export const switchSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid(),
});

export const featureToggleSchema = zod_1.z.object({
    feature: zod_1.z.enum(FEATURE_KEYS),
    enabled: zod_1.z.boolean(),
});
