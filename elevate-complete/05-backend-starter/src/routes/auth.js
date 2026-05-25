const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { pool } = require('../config/db');
const { sign } = require('../auth/jwt');
const { verifyCode } = require('../auth/mfa');
const audit = require('../lib/audit');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query(
    `SELECT u.*, r.code AS role_code
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1 AND u.active = true`,
    [email?.toLowerCase()]
  );
  const user = rows[0];
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    await audit.log({ actor_type: 'user', action: 'login', outcome: 'failure', metadata: { email }, ip: req.ip });
    return res.status(401).json({ error: { code: 'invalid_credentials' } });
  }

  // If MFA enrolled, return short-lived mfa_token
  if (user.mfa_enrolled) {
    const mfa_token = sign({ id: user.id, stage: 'mfa_pending' });
    return res.json({ mfa_required: true, mfa_token });
  }

  // Else issue full session (and prompt enrolment on next visit)
  const token = sign({
    id: user.id,
    organization_id: user.organization_id,
    role: user.role_code,
    role_id: user.role_id,
    mfa_verified: false
  });
  res.cookie(process.env.SESSION_COOKIE_NAME, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
  await audit.log({ organization_id: user.organization_id, actor_id: user.id, action: 'login', ip: req.ip });
  res.json({ user: { id: user.id, role: user.role_code }, mfa_enrolment_required: !user.mfa_enrolled });
});

router.post('/mfa/verify', async (req, res) => {
  const { mfa_token, code } = req.body;
  // ... verify mfa_token, look up user, verify TOTP, issue full session
  res.status(501).json({ error: { code: 'not_implemented', message: 'Stub — implement against schema' } });
});

router.post('/logout', async (req, res) => {
  res.clearCookie(process.env.SESSION_COOKIE_NAME);
  res.status(204).end();
});

module.exports = router;
