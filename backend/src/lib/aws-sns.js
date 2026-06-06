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

// Only AWS SNS hosts may serve signing certs or receive a SubscribeURL GET.
// Guards against SSRF: a validly-signed message (from an attacker's own SNS
// topic) could otherwise point SigningCertURL/SubscribeURL at an internal host.
const SNS_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

export function isSnsHost(url) {
    try { return SNS_HOST_RE.test(new URL(url).host); } catch { return false; }
}

function fetchText(url, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.get(url, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        // No timeout => a stalled host pins a worker slot (DoS). Bound it.
        req.setTimeout(timeoutMs, () => req.destroy(new Error('sns fetch timeout')));
    });
}

// Verify an SNS message signature. Returns true/false. msg = parsed JSON body.
export async function verifySnsSignature(msg) {
    const certUrl = msg.SigningCertURL || msg.SigningCertUrl;
    if (!certUrl) return false;
    // Allowlist AWS SNS cert hosts only (blocks lookalike/internal cert hosts).
    if (!isSnsHost(certUrl)) return false;
    const fields = SIGN_FIELDS[msg.Type];
    if (!fields) return false;
    // Every signed field that is REQUIRED for this Type must be present. Subject
    // is the only optional field (absent on messages with no subject); a missing
    // required field means a tampered/truncated payload — reject.
    for (const f of fields) {
        if (msg[f] === undefined && f !== 'Subject') return false;
    }
    const canonical = fields
        .filter((f) => msg[f] !== undefined)
        .map((f) => `${f}\n${msg[f]}\n`)
        .join('');
    const pem = await fetchText(certUrl);
    // SignatureVersion '1' => RSA-SHA1 (legacy); '2' => RSA-SHA256 (default on
    // topics created since ~2022). Pick the algorithm from the message.
    const algo = String(msg.SignatureVersion) === '2' ? 'RSA-SHA256' : 'RSA-SHA1';
    const verifier = crypto_1.default.createVerify(algo);
    verifier.update(canonical, 'utf8');
    try {
        return verifier.verify(pem, msg.Signature, 'base64');
    } catch {
        return false;
    }
}

export async function confirmSubscription(subscribeUrl) {
    // SubscribeURL is signed by AWS, but a message from an attacker's own SNS
    // topic carries a valid signature — so re-check the host to block SSRF to
    // internal addresses (e.g. metadata endpoints, adjacent services).
    if (!isSnsHost(subscribeUrl)) throw new Error('refusing non-SNS SubscribeURL');
    await fetchText(subscribeUrl);
}
