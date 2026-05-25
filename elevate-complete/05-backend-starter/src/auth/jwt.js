const jwt = require('jsonwebtoken');

const TTL = parseInt(process.env.SESSION_TTL_MINUTES || '30', 10) * 60;

function sign(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: TTL });
}

function verify(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { sign, verify, TTL };
