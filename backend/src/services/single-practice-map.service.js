// An organisation with exactly ONE practice has nothing to decide.
//
// Every ad account, GoHighLevel subaccount and CallRail company carries a
// practice_id, and everything practice-scoped in the product reads it: ad spend
// is stamped from the AD ACCOUNT's mapping, a GHL lead's practice comes from the
// SUBACCOUNT that fetched it. Leave those null and a practice filter returns
// nothing — not "not mapped", just 0, beside spend that is plainly real.
//
// That is what happened on a live single-practice sub-account: its one Meta ad
// account and its one GHL subaccount were both unmapped, so filtering to its
// ONLY practice showed Google spend, no Facebook card at all, and 0 leads
// against 2,957 stored ones.
//
// When an org has one practice the mapping is not a guess — it is the only
// possible answer, and asking a single-practice tenant to choose from a list of
// one is a step that exists purely to be forgotten. This codebase already took
// that view once: migration 000085 stamped existing GHL contacts and leads
// "when the org has exactly one practice".
//
// TWO OR MORE PRACTICES AND IT DOES NOTHING. There is no name matching, no
// "closest" practice, no first-in-the-list. A wrong practice is worse than an
// unmapped one — it moves money onto the wrong site's report and looks
// authoritative doing it — and rules.md forbids matching on a name where an id
// exists. Multi-practice orgs keep the explicit mapping screen.
//
// It also never overwrites: only rows whose practice_id IS NULL are stamped, so
// a deliberate mapping (or a deliberate unmapping followed by a second practice
// being added) is never quietly rewritten.
import { serviceClient } from "../lib/supabase.js";
import { adAttributionRepository } from "../repositories/ad-attribution.repository.js";
import { adGrainRepository } from "../repositories/ad-grain.repository.js";

// integration_accounts holds both of these; both carry practice_id and both
// stamp the rows they fetch with it.
const ACCOUNT_PROVIDERS = ['gohighlevel', 'callrail'];

async function solePracticeId(orgId) {
  const { data, error } = await serviceClient
    .from('practices')
    .select('id')
    .eq('organisation_id', orgId)
    .limit(2);
  if (error) throw new Error(`practices read: ${error.message}`);
  return (data ?? []).length === 1 ? data[0].id : null;
}


// Stamp the practice onto a provider's account only where that provider has
// exactly ONE account in scope. Returns how many rows were stamped.
async function stampSoleAccount({ table, orgId, practiceId, scope, groupBy }) {
  const { data, error } = await scope(
    serviceClient.from(table).select(`id, ${groupBy}, practice_id`).eq('organisation_id', orgId),
  );
  if (error) throw new Error(`${table} read: ${error.message}`);

  const byProvider = new Map();
  for (const row of data ?? []) {
    const list = byProvider.get(row[groupBy]) ?? [];
    list.push(row);
    byProvider.set(row[groupBy], list);
  }

  let stamped = 0;
  for (const [provider, rows] of byProvider) {
    if (rows.length !== 1) continue;          // ambiguous — leave it to a human
    if (rows[0].practice_id !== null) continue; // never overwrite a decision
    const { error: upErr } = await serviceClient
      .from(table)
      .update({ practice_id: practiceId })
      .eq('organisation_id', orgId)
      .eq('id', rows[0].id);
    if (upErr) throw new Error(`${table} stamp (${provider}): ${upErr.message}`);
    stamped += 1;
  }
  return stamped;
}

export const singlePracticeMapService = {
  async run(orgId) {
    if (!orgId) throw new Error('single-practice map: orgId required');
    const practiceId = await solePracticeId(orgId);
    if (!practiceId) return { mapped: false, reason: 'not a single-practice organisation' };

    // ONE PRACTICE IS ONLY UNAMBIGUOUS ONE ACCOUNT AT A TIME.
    //
    // integration_accounts carries a unique index on (organisation_id,
    // provider, practice_id) — a practice may hold at most ONE subaccount per
    // provider — so a blanket update of two unmapped GoHighLevel subaccounts
    // onto the same practice does not map one and skip the other: it violates
    // the index and the whole statement fails. ad_accounts has no such index,
    // but the ambiguity is real either way. Two accounts and one practice is a
    // question with no obvious answer, and this exists only to answer the
    // obvious ones — so it maps a provider's accounts only when that provider
    // has exactly one, and leaves the rest to the mapping screen.
    const adAccounts = await stampSoleAccount({
      table: 'ad_accounts', orgId, practiceId,
      // Only the SELECTED ones: an account the owner excluded is not theirs to
      // report on, so stamping it would map spend they said not to count. It
      // is also the right denominator — one ticked account beside three
      // unticked ones is still unambiguous.
      scope: (q) => q.eq('is_selected', true),
      groupBy: 'provider',
    });

    const subaccounts = await stampSoleAccount({
      table: 'integration_accounts', orgId, practiceId,
      scope: (q) => q.in('provider', ACCOUNT_PROVIDERS),
      groupBy: 'provider',
    });
    if (adAccounts === 0 && subaccounts === 0) {
      return { mapped: false, reason: 'everything already mapped', adAccounts: 0, subaccounts: 0 };
    }

    // A mapping that only applied to rows fetched AFTER it would leave every
    // stored row reading the old answer — which for these tenants means NULL,
    // for ever, since nothing re-fetches history. Each restamp is independent
    // and non-fatal: campaign-grain spend feeds every existing figure in the
    // product, so a failure in one of the newer tables must not cost it.
    const restamped = {};
    for (const [name, fn] of [
      ['adMetrics', () => adAttributionRepository.restampAdMetricsPractices(orgId)],
      ['adGrains', () => adGrainRepository.restampPractices(orgId)],
      ['ghl', async () => {
        const { data, error } = await serviceClient.rpc('restamp_ghl_practices', { p_org: orgId });
        if (error) throw new Error(error.message);
        const r = Array.isArray(data) ? data[0] : data;
        return Number(r?.contacts_updated ?? 0) + Number(r?.leads_updated ?? 0);
      }],
    ]) {
      try {
        restamped[name] = await fn();
      } catch (err) {
        restamped[name] = null;
        console.error('[single-practice-map] %s restamp failed for org %s: %s', name, orgId, err.message);
      }
    }

    console.log('[single-practice-map] org %s: mapped %d ad account(s) and %d subaccount(s) to its only practice; restamped %j',
      orgId, adAccounts, subaccounts, restamped);
    return { mapped: true, practiceId, adAccounts, subaccounts, restamped };
  },

  // Non-fatal wrapper for the sync paths: a pull that succeeded must not be
  // recorded as failed because a convenience on top of it did not.
  async runQuietly(orgId, label = 'sync') {
    try {
      return await this.run(orgId);
    } catch (err) {
      console.error('[single-practice-map] after %s failed for org %s: %s', label, orgId, err.message);
      return { mapped: false, error: String(err.message).slice(0, 200) };
    }
  },
};
