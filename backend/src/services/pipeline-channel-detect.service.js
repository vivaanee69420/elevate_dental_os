// Fill the pipeline -> ad channel map from the leads themselves.
//
// The map decides which report a lead belongs to (migrations 000171/000178/
// 000179), and until now it could only be filled by hand on a settings screen.
// That made every new organisation silently empty: real spend on the Marketing
// pages, zero leads beneath it, and no indication that a step existed. This
// runs the detection so a tenant is mapped as soon as its data lands, for every
// account, not the one that reported it.
//
// WHERE IT RUNS: after a GoHighLevel sync (the leads it decides on are exactly
// what that sync just wrote) and after an ad platform connects (the campaign
// ids it resolves against are what that sync just wrote). Both are the moments
// the evidence changes; running it anywhere else would be asking the same
// question of the same data.
//
// It only ever FILLS A GAP — see detectMappings. An owner's choice, including a
// deliberate "no channel", is never overwritten.
import { adChannelPipelineRepository } from "../repositories/ad-channel-pipeline.repository.js";
import { detectMappings } from "../lib/marketing/pipeline-channel-inference.js";

export const pipelineChannelDetectService = {
  /**
   * @returns {{detected:number, rows:Array, considered:number}}
   */
  async run(orgId) {
    if (!orgId) throw new Error('detect: orgId required');
    const [counts, existing] = await Promise.all([
      adChannelPipelineRepository.attributionCounts(orgId),
      adChannelPipelineRepository.list(orgId),
    ]);
    const rows = detectMappings(counts, existing);
    await adChannelPipelineRepository.insertDetected(orgId, rows);
    if (rows.length) {
      console.log('[pipeline-channel] org %s: mapped %d pipeline(s) automatically: %s',
        orgId, rows.length,
        rows.map((r) => `${r.ghl_pipeline_id}->${r.channel} (${Math.round(r.detected_share * 100)}% of ${r.detected_leads})`).join(', '));
    }
    return { detected: rows.length, rows, considered: counts.length };
  },

  // Non-fatal wrapper for the sync paths. Detection is a convenience on top of
  // a sync that has already succeeded, so it must never turn a good pull into
  // a failed integration — the same reasoning that wraps the deep-grain pull.
  async runQuietly(orgId, label = 'sync') {
    try {
      return await this.run(orgId);
    } catch (err) {
      console.error('[pipeline-channel] detection after %s failed for org %s: %s',
        label, orgId, err.message);
      return { detected: 0, rows: [], considered: 0, error: String(err.message).slice(0, 200) };
    }
  },
};
