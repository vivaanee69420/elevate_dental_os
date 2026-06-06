// SMS sending via AWS SNS + SNS message signature verification for webhooks.
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import * as https_1 from "node:https";
import * as crypto_1 from "node:crypto";

const client = new SNSClient({ region: process.env.AWS_REGION || 'eu-west-2' });

export async function sendSMS(opts) {
    const attrs = {};
    if (process.env.SNS_SENDER_ID) {
        attrs['AWS.SNS.SMS.SenderID'] = { DataType: 'String', StringValue: process.env.SNS_SENDER_ID };
    }
    attrs['AWS.SNS.SMS.SMSType'] = { DataType: 'String', StringValue: process.env.SNS_SMS_TYPE || 'Transactional' };
    const res = await client.send(new PublishCommand({
        PhoneNumber: opts.to,
        Message: opts.body,
        MessageAttributes: attrs,
    }));
    return res.MessageId;
}

// Fields, in order, that SNS signs for each message Type.
const SIGN_FIELDS = {
    Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
    SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
    UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

function fetchText(url) {
    return new Promise((resolve, reject) => {
        https_1.default.get(url, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// Verify an SNS message signature. Returns true/false. msg = parsed JSON body.
export async function verifySnsSignature(msg) {
    const certUrl = msg.SigningCertURL || msg.SigningCertUrl;
    if (!certUrl) return false;
    let host;
    try { host = new URL(certUrl).host; } catch { return false; }
    // Allowlist AWS SNS cert hosts only.
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) return false;
    const fields = SIGN_FIELDS[msg.Type];
    if (!fields) return false;
    const canonical = fields
        .filter((f) => msg[f] !== undefined)
        .map((f) => `${f}\n${msg[f]}\n`)
        .join('');
    const pem = await fetchText(certUrl);
    const verifier = crypto_1.default.createVerify('RSA-SHA1');
    verifier.update(canonical, 'utf8');
    try {
        return verifier.verify(pem, msg.Signature, 'base64');
    } catch {
        return false;
    }
}

export async function confirmSubscription(subscribeUrl) {
    await fetchText(subscribeUrl);
}
