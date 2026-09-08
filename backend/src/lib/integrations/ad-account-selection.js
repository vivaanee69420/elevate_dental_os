// Which ad accounts an organisation has actually asked us to report on.
//
// `ad_accounts.is_selected` is the tick box on the Integrations panel. It was
// written by that panel and read by NOTHING: `selectedAdAccountIds` had no
// callers, neither sync consulted it, and no report filtered on it. The tick
// was decorative, and the panel's own copy ("unticking hides it from the
// views") was untrue.
//
// Measured on live data before this was written, three of the four orgs with
// ad accounts were reporting on accounts they had explicitly excluded:
//
//   gm dental Rochester  Meta   1 of 4 ticked — the 3 excluded carried
//                               GBP 100,192.89, against GBP 45,437.19 included,
//                               so its Facebook figures read 3.2x high
//   gm dental Rochester  Google 1 of 4 ticked — GBP 27,609.19 excluded
//   GM Dental Group      Google 3 of 10 ticked — GBP 87,925.62 excluded,
//                               more than the GBP 82,873.42 included
//
// Those are sibling practices' and other brands' accounts, reachable because
// one Meta/Google login can see a whole business manager. Nothing here crosses
// a tenant boundary — each org pulled them with its own credential — but a
// tenant that says "these four are not mine" and is charged for them anyway is
// reading someone else's spend as its own.
//
// The filter belongs HERE, at the pull, rather than in the ~20 reporting RPCs
// that read ad_metrics and the deep-grain tables: an exclusion applied in one
// reader and forgotten in the next is how two tabs of the same report end up
// disagreeing, and every future RPC would have to remember it.

// Meta ids are stored bare and prefixed with `act_` at the call site; Google's
// are digits, sometimes dashed in the console. Compare on a normal form, since
// an id-format mismatch here would filter the pull to nothing and freeze a
// tenant's data behind a green tick.
export function normaliseAccountId(id) {
  return String(id ?? '').trim().replace(/^act_/i, '').replace(/-/g, '');
}

/**
 * @param {string[]} reachable  every account the stored credential can pull
 * @param {string[]|null} selected  ticked ids, or null when the org has no
 *   ad_accounts rows yet — a first connect, where nothing has been ticked
 *   because nothing has been discovered. Pull everything so there is something
 *   to choose FROM.
 * @returns {{ ids: string[], excluded: string[], warning: string|null }}
 */
export function applyAccountSelection(reachable, selected) {
  const all = (reachable ?? []).map(String);
  if (selected === null || selected === undefined) {
    return { ids: all, excluded: [], warning: null };
  }

  const keep = new Set(selected.map(normaliseAccountId));
  const ids = all.filter((id) => keep.has(normaliseAccountId(id)));
  const excluded = all.filter((id) => !keep.has(normaliseAccountId(id)));

  // Two ways to end up pulling nothing, and they are not the same event.
  //
  // Nothing ticked is a decision — the panel says "0 of 4 included" and the
  // owner meant it. A tick list that matches none of the reachable accounts is
  // a FAULT: either the credential lost access to everything selected, or the
  // two id formats have drifted apart. Both would otherwise present as a sync
  // that ran clean and pulled nothing, which is the failure this codebase has
  // been bitten by before — quiet, and indistinguishable from a quiet month.
  let warning = null;
  if (ids.length === 0) {
    warning = selected.length === 0
      ? `No ad accounts are included — ${all.length} reachable account(s) are all unticked on the Integrations panel, so nothing was pulled.`
      : `None of the ${selected.length} included ad account(s) are reachable with the stored credential (${all.length} reachable: ${all.join(', ')}). Nothing was pulled — check the selection on the Integrations panel.`;
  }
  return { ids, excluded, warning };
}
