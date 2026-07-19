import { z } from "zod";

export const dailyReportSettingsSchema = z.object({
    // GHL inbound webhook URLs are https and unauthenticated — the URL is the
    // secret, so refuse to store one sent over plaintext http.
    //
    // Optional: the API never returns the raw URL (only a masked form), so an
    // owner who wants to pause/resume the report without re-pasting it must be
    // able to PUT with `enabled` only. The controller decides whether omitting
    // it is acceptable (it is, only when a settings row already exists).
    webhookUrl: z.string().url().refine((u) => u.startsWith('https://'), {
        message: 'Webhook URL must use https',
    }).optional(),
    enabled: z.boolean().default(false),
});
