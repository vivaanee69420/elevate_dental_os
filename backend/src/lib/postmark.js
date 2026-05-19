// Email sending via Postmark
import * as postmark_1 from "postmark";

const postmark = new postmark_1.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

export async function sendEmail(opts) {
    const result = await postmark.sendEmail({
        From: opts.from || process.env.POSTMARK_FROM || 'no-reply@elevate.app',
        To: opts.to,
        Subject: opts.subject,
        HtmlBody: opts.body,
        MessageStream: 'outbound',
    });
    return result.MessageID;
}
