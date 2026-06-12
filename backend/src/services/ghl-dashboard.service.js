// ============================================================================
// GHL dashboard service — assembles the consolidated GoHighLevel view. Loads the
// org's GHL subaccounts, runs the aggregate RPC (optionally scoped to one
// account's practice), then builds:
//   totals    — every metric summed across all returned practice rows
//   perAccount — one entry per subaccount (+ an "Unmapped" entry for null-practice
//                rows), used for both the single-account filter and drill-downs
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

    let practiceFilter = practiceId;
    if (accountId) {
      const acct = accounts.find((a) => a.id === accountId);
      practiceFilter = acct?.practice_id ?? null;
    }

    const rows = await ghlDashboardRepository.aggregate(orgId, since, until, practiceFilter);
    const byPractice = new Map(rows.map((r) => [r.practice_id, r]));

    const perAccount = accounts.map((a) => {
      const r = byPractice.get(a.practice_id) ?? {};
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
      };
    });

    const mappedPractices = new Set(accounts.map((a) => a.practice_id));
    const unmappedRows = rows.filter((r) => !mappedPractices.has(r.practice_id));
    if (unmappedRows.length) {
      const u = unmappedRows;
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
      });
    }

    const sum = (f) => rows.reduce((s, r) => s + num(r[f]), 0);
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
