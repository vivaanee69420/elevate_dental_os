/**
 * Reconciliation control: revenue-by-practice
 * See: ../../../../03-backend-spec/RECONCILIATION_RULES.md
 */
module.exports = async function ({ organization_id, period_start, period_end }) {
  throw new Error('Control revenue-by-practice not implemented — see RECONCILIATION_RULES.md for SQL + tolerance');
};
