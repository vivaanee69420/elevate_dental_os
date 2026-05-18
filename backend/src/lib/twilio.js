"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMS = sendSMS;
// SMS sending via Twilio
const twilio_1 = __importDefault(require("twilio"));
const client = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
async function sendSMS(opts) {
    const msg = await client.messages.create({
        body: opts.body,
        from: process.env.TWILIO_FROM_NUMBER,
        to: opts.to,
    });
    return msg.sid;
}
