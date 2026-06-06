// Email sending via AWS SES v2. Single platform sending identity.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const client = new SESv2Client({ region: process.env.AWS_REGION || 'eu-west-2' });

export async function sendEmail(opts) {
    const cmd = new SendEmailCommand({
        FromEmailAddress: opts.from || process.env.SES_FROM || 'notifications@elevate.app',
        Destination: { ToAddresses: [opts.to] },
        ConfigurationSetName: process.env.SES_CONFIGURATION_SET || undefined,
        Content: {
            Simple: {
                Subject: { Data: opts.subject || '' },
                Body: { Html: { Data: opts.html || opts.body || '' } },
            },
        },
    });
    const res = await client.send(cmd);
    return res.MessageId;
}
