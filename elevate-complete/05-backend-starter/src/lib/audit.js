/**
 * Audit log writer. Every mutating action should call this.
 * Audit rows are immutable at the DB level (see schema triggers).
 */
const { pool } = require('../config/db');

async function log({
  organization_id,
  actor_type = 'user',
  actor_id,
  action,
  object_type,
  object_id,
  outcome = 'success',
  ip,
  user_agent,
  metadata
}) {
  await pool.query(
    `INSERT INTO audit_logs
       (organization_id, actor_type, actor_id, action, object_type, object_id, outcome, ip, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [organization_id, actor_type, actor_id, action, object_type, object_id, outcome, ip, user_agent, metadata]
  );
}

module.exports = { log };
