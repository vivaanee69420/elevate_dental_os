// ============================================================================
// Associate status banding — derives a top/good/review band from recent
// appointment completion rate and volume. Pure; unit-tested.
// ============================================================================
export function associateStatus({ completionPct, total }) {
    if (!total) return 'review';                              // no recent activity
    if (completionPct != null && completionPct >= 85 && total >= 40) return 'top';
    if ((completionPct != null && completionPct < 70) || total < 20) return 'review';
    return 'good';
}
