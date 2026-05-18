"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
// Email sending via Postmark
const postmark_1 = require("postmark");
const postmark = new postmark_1.ServerClient(process.env.POSTMARK_SERVER_TOKEN);
async function sendEmail(opts) {
    const result = await postmark.sendEmail({
        From: opts.from || process.env.POSTMARK_FROM || 'no-reply@elevate.app',
        To: opts.to,
        Subject: opts.subject,
        HtmlBody: opts.body,
        MessageStream: 'outbound',
    });
    return result.MessageID;
}
