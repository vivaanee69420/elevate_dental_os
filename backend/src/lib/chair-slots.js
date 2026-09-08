// ============================================================================
// Chair slot windows — the SINGLE definition of what a slot spans.
//
// These boundaries used to live only in the frontend (chair-util.ts) for
// display, while the backend had none at all. Two copies of a window
// convention drift invisibly, so the server owns them and returns slot
// boundaries in its payloads; the frontend renders what it is sent.
//
// The first slot starts at the day's OPENING time and the last ends at its
// CLOSING time, rather than at a fixed 08:00/20:00 envelope. That is what
// guarantees the invariant the tests assert: the slot minutes for a day sum
// to exactly (close - open) for ANY opening hours. Under a fixed envelope a
// practice opening at 07:00 would silently lose an hour of capacity, and the
// loss would look like low occupancy rather than a bug.
//
// Times are MINUTES FROM LOCAL MIDNIGHT, never instants. These are wall-clock
// opening times; storing them as instants would shift them across the BST
// boundary. Pure module — no I/O.
// ============================================================================

export const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

// The three INTERIOR boundaries only. The outer two come from the day's hours.
export const SLOT_EDGES = [11 * 60, 14 * 60, 17 * 60]; // 11:00, 14:00, 17:00

/** Index of a slot key in SLOTS, or -1 for an unknown key. */
export function slotIndexOf(slot) {
    return SLOTS.indexOf(slot);
}

/**
 * The [start, end) minute window a slot occupies on a day open
 * `openMinute`..`closeMinute`. The first slot starts at the open, the last
 * ends at the close.
 */
export function slotWindow(slotIndex, openMinute, closeMinute) {
    const start = slotIndex === 0 ? openMinute : SLOT_EDGES[slotIndex - 1];
    const end = slotIndex === SLOTS.length - 1 ? closeMinute : SLOT_EDGES[slotIndex];
    return { start, end };
}

/** Minutes of a slot that fall inside the day's opening hours. Never negative. */
export function slotAvailableMinutes(slotIndex, openMinute, closeMinute) {
    if (openMinute == null || closeMinute == null) return 0;
    if (closeMinute <= openMinute) return 0;
    if (slotIndex < 0 || slotIndex >= SLOTS.length) return 0;
    const { start, end } = slotWindow(slotIndex, openMinute, closeMinute);
    const from = Math.max(start, openMinute);
    const to = Math.min(end, closeMinute);
    return Math.max(0, to - from);
}

/** Available minutes for every slot on one day, in SLOTS order. */
export function daySlotMinutes(openMinute, closeMinute) {
    return SLOTS.map((_, i) => slotAvailableMinutes(i, openMinute, closeMinute));
}
