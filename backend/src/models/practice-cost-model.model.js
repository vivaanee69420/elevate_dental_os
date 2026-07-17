// practice_cost_model request schemas. Money arrives as integer PENCE from the
// client (the UI converts pounds -> pence at its boundary, per the repo
// convention). Every field optional so a partial edit is possible, but at least
// one must be present.
import * as zod_1 from "zod";

const PENCE = zod_1.z.number().int().nonnegative().nullable();

export const costModelQuerySchema = zod_1.z.object({
    asOf: zod_1.z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'asOf must be YYYY-MM-DD' }).optional(),
});

export const costModelUpsertSchema = zod_1.z.object({
    fixedCostPenceMonth: PENCE.optional(),
    breakevenLowPence: PENCE.optional(),
    breakevenHighPence: PENCE.optional(),
    workingDaysPerMonth: zod_1.z.number().int().min(1).max(31).optional(),
    revenueTargetPenceMonth: PENCE.optional(),
}).refine(v => Object.keys(v).length > 0, { message: 'no fields to update' })
  .refine(
      v => v.breakevenLowPence == null || v.breakevenHighPence == null || v.breakevenLowPence <= v.breakevenHighPence,
      { message: 'breakevenLowPence must not exceed breakevenHighPence' },
  );
