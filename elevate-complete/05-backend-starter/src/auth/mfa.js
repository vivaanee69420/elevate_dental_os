const speakeasy = require('speakeasy');

function generateSecret(email) {
  return speakeasy.generateSecret({
    name: `${process.env.MFA_ISSUER || 'Elevate'}:${email}`,
    length: 32
  });
}

function verifyCode(secret, code) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1  // ±30s drift allowed
  });
}

module.exports = { generateSecret, verifyCode };
