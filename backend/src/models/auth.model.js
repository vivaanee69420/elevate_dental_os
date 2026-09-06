// ============================================================================
// Auth model — Zod schemas + inferred types for signup / invite input.
// ============================================================================
import * as zod_1 from "zod";
export const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8),
    full_name: zod_1.z.string(),
    organisation_name: zod_1.z.string(),
});
export const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
export const inviteSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']),
    // Optional per-member permission overrides applied at provisioning time.
    permissions: zod_1.z.record(zod_1.z.boolean()).optional(),
});
export const removeMemberSchema = zod_1.z.object({
    user_id: zod_1.z.string().uuid(),
});
// Admin provisions a member WITH a password (no email round-trip): the
// member is 'active' immediately and can log in at once. `password` reuses
// the signup min(8) rule. `permissions` is bounded at the service layer by
// the caller's own effective grants (assertGrantCeiling).
export const provisionMemberSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']),
    password: zod_1.z.string().min(8),
    permissions: zod_1.z.record(zod_1.z.boolean()).optional(),
});
// Admin resets an existing member's password.
export const setPasswordSchema = zod_1.z.object({
    user_id: zod_1.z.string().uuid(),
    password: zod_1.z.string().min(8),
});

// Switch the acting account (multi-org membership).
export const switchOrgSchema = zod_1.z.object({
    orgId: zod_1.z.string().uuid(),
});

// Settings → Team, per-user save. `permissions` values are tri-state:
// true grants, false explicitly denies, and null REMOVES the override so the
// row inherits its role again — which is why this is nullable() rather than a
// plain boolean record. `organisation_ids` is accepted only from an agency
// admin; the service, not this schema, is what enforces that.
export const saveMemberSchema = zod_1.z.object({
    full_name: zod_1.z.string().min(1).optional(),
    phone: zod_1.z.string().optional(),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']).optional(),
    permissions: zod_1.z.record(zod_1.z.boolean().nullable()).optional(),
    organisation_ids: zod_1.z.array(zod_1.z.string().uuid()).optional(),
});

// Settings → Team, create. `password` present takes the provision path (the
// member is active at once); absent takes the invite-email path.
// `home_organisation_id` is where the login LIVES — accepted only from an
// agency admin, and validated against the orgs they administer.
export const createMemberSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    full_name: zod_1.z.string().min(1),
    role: zod_1.z.enum(['owner', 'practice_manager', 'reception', 'analyst']),
    password: zod_1.z.string().min(8).optional(),
    phone: zod_1.z.string().optional(),
    permissions: zod_1.z.record(zod_1.z.boolean()).optional(),
    home_organisation_id: zod_1.z.string().uuid().optional(),
    organisation_ids: zod_1.z.array(zod_1.z.string().uuid()).optional(),
});
