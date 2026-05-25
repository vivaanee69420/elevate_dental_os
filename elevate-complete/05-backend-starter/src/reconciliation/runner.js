/**
 * Reconciliation runner.
 * Dispatches the requested control to its implementation file in ./controls/.
 *
 * See: ../../../03-backend-spec/RECONCILIATION_RULES.md
 */
const { pool } = require('../config/db');
const audit = require('../lib/audit');

const CONTROLS = {
  cash_received:        () => require('./controls/cash-received'),
  revenue_by_practice:  () => require('./controls/revenue-by-practice'),
  aged_debt:            () => require('./controls/aged-debt'),
  treatment_starts:     () => require('./controls/treatment-starts'),
  entity_totals:        () => require('./controls/entity-totals')
};

async function runControl({ control, period_start, period_end, actor_id }) {
  const impl = CONTROLS[control];
  if (!impl) throw new Error(`Unknown control: ${control}`);

  // For each org → run for each practice/entity scope as appropriate
  const { rows: orgs } = await pool.query('SELECT id FROM organizations');
  for (const org of orgs) {
    await impl()({ organization_id: org.id, period_start, period_end });
  }

  await audit.log({
    actor_type: 'system',
    action: 'reconciliation_run',
    object_type: 'control',
    metadata: { control, period_start, period_end }
  });
}

module.exports = runControl;
