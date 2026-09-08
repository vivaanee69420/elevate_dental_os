// Which ad channel a GoHighLevel pipeline belongs to, inferred from the
// attribution its own leads carry.
//
// Mapping a pipeline is a STRONG claim. Since 000171/000178/000179 every lead
// in a mapped pipeline joins that channel's pool whether or not it carries an
// ad id — that is the owner's stated rule — so a wrong guess does not merely
// mislabel a few leads, it moves the whole pipeline's population onto one
// report and out of another, and drags cost per lead with it.
//
// So the thresholds are deliberately conservative, and the share is taken over
// the pipeline's TOTAL leads, not over its attributed ones. Measured on the
// sub-account that prompted this:
//
//   pipeline         leads   meta   google   over total   over attributed
//   Z6ewbyYz…          656    606        0        92%             100%
//   UbG70w1V…           70     57        1        81%              98%
//   atU9xlOh…           68     49        0        72%             100%
//   tCToHaT5…          110      3       76        69% (google)     96%
//   iczOOfPd…        1,336     52        2         4%              96%
//
// That last row is the reason. Over ATTRIBUTED leads it looks 96% Meta and
// would have been mapped, sweeping 1,336 people — the org's largest pipeline,
// and plainly a general intake one — into the Meta pool on the evidence of 52.
// Over total leads it is 4% and correctly left for a human. An unmapped
// pipeline costs a sentence on the page; a wrongly mapped one costs the number.

// A pipeline needs enough people to be evidence at all. Ten leads at 60% is
// six — noise. Twenty-five is small enough that a new practice's first month
// still gets mapped, and large enough that a handful of stray ids cannot.
export const MIN_LEADS = 25;

// 60% of everyone in the pipeline, not 60% of the identifiable ones.
export const MIN_SHARE = 0.6;

// And it must be CLEARLY one channel: a pipeline half Meta and half Google is
// a mixed intake pipeline, and picking the larger half would be a coin toss
// presented as a fact.
export const MIN_MARGIN = 2;

/**
 * @param {{leads:number, meta_leads:number, google_leads:number}} row
 * @returns {{channel:'meta_ads'|'google_ads', share:number, leads:number}|null}
 *   null when the evidence does not support a confident answer — which is a
 *   result, not a failure, and leaves the pipeline for the owner.
 */
export function inferChannel(row) {
  const leads = Number(row?.leads ?? 0);
  const meta = Number(row?.meta_leads ?? 0);
  const google = Number(row?.google_leads ?? 0);
  if (leads < MIN_LEADS) return null;

  const [channel, top, other] = meta >= google
    ? ['meta_ads', meta, google]
    : ['google_ads', google, meta];
  if (top === 0) return null;

  const share = top / leads;
  if (share < MIN_SHARE) return null;
  // `other * MIN_MARGIN > top` rather than a ratio, so a zero on the losing
  // side never divides.
  if (other * MIN_MARGIN > top) return null;

  return { channel, share: Math.round(share * 1000) / 1000, leads };
}

/**
 * Detection over a whole org, with the pipelines a human has already spoken
 * about removed first.
 *
 * @param {Array} counts        rows from ad_pipeline_attribution_counts
 * @param {Array} existing      current ad_channel_pipelines rows
 * @returns {Array} rows to write, one per newly-decided pipeline
 */
export function detectMappings(counts, existing) {
  // A row of ANY kind means a decision exists: a channel someone chose, a null
  // channel meaning "none", or a previous automatic guess. Detection only ever
  // fills a gap — it never argues with a row that is already there, because an
  // owner who unassigns a pipeline must not find it reassigned by morning.
  const decided = new Set(
    (existing ?? []).map((r) => `${r.integration_account_id}|${r.ghl_pipeline_id}`),
  );

  const out = [];
  for (const row of counts ?? []) {
    const key = `${row.integration_account_id}|${row.ghl_pipeline_id}`;
    if (decided.has(key)) continue;
    const hit = inferChannel(row);
    if (!hit) continue;
    out.push({
      integration_account_id: row.integration_account_id,
      ghl_pipeline_id: String(row.ghl_pipeline_id),
      pipeline_name: row.pipeline_name ?? null,
      channel: hit.channel,
      source: 'auto',
      detected_leads: hit.leads,
      detected_share: hit.share,
    });
  }
  return out;
}
