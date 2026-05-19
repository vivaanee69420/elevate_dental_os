// SMS sending via Twilio
import * as twilio_1 from "twilio";

const client = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function sendSMS(opts) {
    const msg = await client.messages.create({
        body: opts.body,
        from: process.env.TWILIO_FROM_NUMBER,
        to: opts.to,
    });
    return msg.sid;
}
