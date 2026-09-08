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

export const singlePracticeMapService = {
  async run(orgId) {
    if (!orgId) throw new Error('single-practice map: orgId required');
    const practiceId = await solePracticeId(orgId);
    if (!practiceId) return { mapped: false, reason: 'not a single-practice organisation' };

    // Ad accounts. Only the SELECTED ones: an account the owner excluded is not
    // theirs to report on, so stamping it would map spend they have said they
    // do not want counted.
    const { data: adRows, error: adErr } = await serviceClient
      .from('ad_accounts')
      .update({ practice_id: practiceId })
      .eq('organisation_id', orgId)
      .eq('is_selected', true)
      .is('practice_id', null)
      .select('id');
    if (adErr) throw new Error(`ad_accounts stamp: ${adErr.message}`);

    const { data: iaRows, error: iaErr } = await serviceClient
      .from('integration_accounts')
      .update({ practice_id: practiceId })
      .eq('organisation_id', orgId)
      .in('provider', ACCOUNT_PROVIDERS)
      .is('practice_id', null)
      .select('id');
    if (iaErr) throw new Error(`integration_accounts stamp: ${iaErr.message}`);

    const adAccounts = (adRows ?? []).length;
    const subaccounts = (iaRows ?? []).length;
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
