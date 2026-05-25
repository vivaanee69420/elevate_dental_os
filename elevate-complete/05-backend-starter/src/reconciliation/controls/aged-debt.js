/**
 * Reconciliation control: aged-debt
 * See: ../../../../03-backend-spec/RECONCILIATION_RULES.md
 */
module.exports = async function ({ organization_id, period_start, period_end }) {
  throw new Error('Control aged-debt not implemented — see RECONCILIATION_RULES.md for SQL + tolerance');
};
