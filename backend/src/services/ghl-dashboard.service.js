// ============================================================================
// GHL dashboard service — assembles the consolidated GoHighLevel view. Loads the
// org's GHL subaccounts, runs the aggregate RPC (optionally scoped to one
// account), then builds:
//   totals    — every metric summed across all returned rows
//   perAccount — one entry per subaccount matched by integration_account_id
// The RPC (v3) now groups by integration_account_id so each sub-account always
// gets its own isolated row — no more repeated/doubled numbers when two accounts
// share the same practice_id (or both are unmapped / NULL).
// All "total" counts in the RPC are already scoped to the [since, until) window.
// Money stays in integer pence. Conversion % = won / (won + lost).
// ============================================================================
import { integrationAccountRepository } from "../repositories/integration-account.repository.js";
import { ghlDashboardRepository } from "../repositories/ghl-dashboard.repository.js";

const PROVIDER = 'gohighlevel';

const num = (v) => Number(v ?? 0);

// Merge an array of { [key]: count } JSON maps into a descending [{ [keyName]: k, count }].
function mergeCounts(maps, keyName) {
  const acc = new Map();
  for (const map of maps) {
    for (const [k, v] of Object.entries(map ?? {})) {
      acc.set(k, (acc.get(k) ?? 0) + num(v));
    }
  }
  return [...acc.entries()]
    .map(([k, count]) => ({ [keyName]: k, count }))
    .sort((a, b) => b.count - a.count);
}

function conversionPct(won, lost) {
  const decided = won + lost;
  if (decided <= 0) return 0;
  return Math.round((won / decided) * 1000) / 10; // 1 dp
}

export const ghlDashboardService = {
  async getDashboard(orgId, { since, until, accountId = null, practiceId = null }) {
    const accounts = await integrationAccountRepository.list(orgId, PROVIDER);

    // RPC v3 groups by integration_account_id — one row per sub-account, no duplication.
    const rows = await ghlDashboardRepository.aggregate(orgId, since, until, practiceId, accountId);
    // Key by integration_account_id for O(1) lookup
    const byAccount = new Map(rows.map((r) => [r.integration_account_id, r]));

    const apptRows = await ghlDashboardRepository.aggregateAppointments(orgId, since, until, practiceId, accountId);
    const apptByAccount = new Map(apptRows.map((r) => [r.integration_account_id, r]));

    const perAccount = accounts.map((a) => {
      const r = byAccount.get(a.id) ?? {};
      const ar = apptByAccount.get(a.id) ?? {};
      return {
        accountId: a.id,
        label: a.label || 'GoHighLevel',
        practiceId: a.practice_id ?? null,
        status: a.status,
        lastSyncAt: a.last_sync_at ?? null,
        lastError: a.last_error ?? null,
        contacts: num(r.contacts_total),
        leads: num(r.leads_total),
        pipelineValuePence: num(r.pipeline_value_pence),
        conversionPct: conversionPct(num(r.leads_won), num(r.leads_lost)),
        conversations: num(r.conversations_total),
        appointments: num(ar.appts_total),
        appointmentsUpcoming: num(ar.appts_upcoming),
      };
    });

    // Any rows whose integration_account_id doesn't match a known active account
    // (e.g. rows from revoked/deleted accounts, or NULLs) go into "Unmapped".
    const knownAccountIds = new Set(accounts.map((a) => a.id));
    const unmappedRows = rows.filter((r) => !knownAccountIds.has(r.integration_account_id));
    const unmappedApptRows = apptRows.filter((r) => !knownAccountIds.has(r.integration_account_id));
    if (unmappedRows.length || unmappedApptRows.length) {
      const u = unmappedRows;
      const ua = unmappedApptRows;
      perAccount.push({
        accountId: null,
        label: 'Unmapped',
        practiceId: null,
        status: null,
        lastSyncAt: null,
        lastError: null,
        contacts: u.reduce((s, r) => s + num(r.contacts_total), 0),
        leads: u.reduce((s, r) => s + num(r.leads_total), 0),
        pipelineValuePence: u.reduce((s, r) => s + num(r.pipeline_value_pence), 0),
        conversionPct: conversionPct(
          u.reduce((s, r) => s + num(r.leads_won), 0),
          u.reduce((s, r) => s + num(r.leads_lost), 0),
        ),
        conversations: u.reduce((s, r) => s + num(r.conversations_total), 0),
        appointments: ua.reduce((s, r) => s + num(r.appts_total), 0),
        appointmentsUpcoming: ua.reduce((s, r) => s + num(r.appts_upcoming), 0),
      });
    }

    const sum = (f) => rows.reduce((s, r) => s + num(r[f]), 0);
    const apptSum = (f) => apptRows.reduce((s, r) => s + num(r[f]), 0);
    const wonTotal = sum('leads_won');
    const lostTotal = sum('leads_lost');

    const totals = {
      contacts: {
        total: sum('contacts_total'),
        new: sum('contacts_new'),
        bySource: mergeCounts(rows.map((r) => r.contacts_by_source), 'source'),
      },
      leads: {
        total: sum('leads_total'),
        new: sum('leads_new'),
        open: sum('leads_open'),
        won: wonTotal,
        lost: lostTotal,
        pipelineValuePence: sum('pipeline_value_pence'),
        conversionPct: conversionPct(wonTotal, lostTotal),
        byStage: mergeCounts(rows.map((r) => r.leads_by_stage), 'stage'),
      },
      conversations: {
        total: sum('conversations_total'),
        inbound: sum('conversations_inbound'),
        outbound: sum('conversations_outbound'),
        last7d: sum('conversations_last7d'),
      },
      appointments: {
        total: apptSum('appts_total'),
        inWindow: apptSum('appts_in_window'),
        upcoming: apptSum('appts_upcoming'),
        showed: apptSum('appts_showed'),
        noshow: apptSum('appts_noshow'),
        cancelled: apptSum('appts_cancelled'),
        booked: apptSum('appts_booked'),
        byCalendar: mergeCounts(apptRows.map((r) => r.appts_by_calendar), 'calendar'),
      },
      sync: {
        accounts: accounts.length,
        active: accounts.filter((a) => a.status === 'active').length,
        failed: accounts.filter((a) => a.status === 'failed').length,
        lastSyncAt: accounts.reduce((latest, a) => {
          if (!a.last_sync_at) return latest;
          return !latest || a.last_sync_at > latest ? a.last_sync_at : latest;
        }, null),
      },
    };

    return { period: { since, until }, totals, perAccount };
  },
};
