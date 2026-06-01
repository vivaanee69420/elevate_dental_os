// ============================================================================
// Staff service — shapes the team roster from Dentally `/users`. Dentally has
// no HR data (hourly rate, weekly hours, scheduled hours, attendance), so the
// roster carries identity + role + practice + last-login only. "Active" is a
// recency heuristic: logged in within the last 90 days.
// ============================================================================
import { staffRepository } from "../repositories/staff.repository.js";

const ACTIVE_WINDOW_MS = 90 * 86400000;

// Dentally seeds non-contactable placeholder emails on imported/system accounts
// (`import+gmdental-42@dentally.co`, `*needemail*@…`, anything `@dentally.co`).
// These are not real addresses, so surface null -> the screen shows an em dash
// rather than a fake "email".
function cleanEmail(email) {
    if (!email) return null;
    const e = email.trim().toLowerCase();
    if (e.includes('*')) return null;            // *needemail* / *neednewemail* markers
    if (e.startsWith('import+')) return null;     // Dentally import system accounts
    if (e.endsWith('@dentally.co')) return null;  // Dentally placeholder domain
    return email.trim();
}

// Dentally seeds non-human "import" accounts (email `import+gmdental-NN@dentally.co`,
// usually role Administrator) when a practice is migrated in. These are not team
// members, so they are excluded from the roster entirely (not just blanked).
function isImportAccount(staffRow) {
    const e = (staffRow.email ?? '').trim().toLowerCase();
    return e.startsWith('import+');
}

export const staffService = {
    async list(orgId, { practice_id }) {
        const rows = await staffRepository.list(orgId, practice_id);
        const now = Date.now();
        // Drop Dentally import/system accounts — they are not real team members.
        const staff = rows.filter((s) => !isImportAccount(s)).map((s) => {
            const lastLoginMs = s.last_login_at ? new Date(s.last_login_at).getTime() : null;
            const recentlyActive = lastLoginMs != null && now - lastLoginMs <= ACTIVE_WINDOW_MS;
            return {
                id: s.id,
                full_name: s.full_name,
                // Prefer the exact PMS label ("Dentist"); fall back to the enum bucket.
                role: s.pms_role ?? s.role ?? null,
                practice: s.practice?.name ?? null,
                email: cleanEmail(s.email),
                phone: s.phone ?? null,
                last_login_at: s.last_login_at ?? null,
                recently_active: recentlyActive,
            };
        });
        const roles = new Set(staff.map((s) => s.role).filter(Boolean));
        const practices = new Set(staff.map((s) => s.practice).filter(Boolean));
        return {
            staff,
            total_staff: staff.length,
            distinct_roles: roles.size,
            practices_covered: practices.size,
            active_count: staff.filter((s) => s.recently_active).length,
        };
    },
};
