import { z } from "zod";

export const dailyReportSettingsSchema = z.object({
    // GHL inbound webhook URLs are https and unauthenticated — the URL is the
    // secret, so refuse to store one sent over plaintext http.
    webhookUrl: z.string().url().refine((u) => u.startsWith('https://'), {
        message: 'Webhook URL must use https',
    }),
    enabled: z.boolean().default(false),
});
