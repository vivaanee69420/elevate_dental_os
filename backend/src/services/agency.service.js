// ============================================================================
// Agency → sub-account lifecycle. Every child-targeting call re-validates
// child-of-agency via childOrgs (no trust in caller-supplied ids).
//
// Creating a sub-account makes the ORGANISATION only; users are added to it
// afterwards with a permanent password the agency sets. There is deliberately
// no temporary-password handover — user provisioning REUSES provisionMember,
// so a sub-account user is an ordinary member of exactly one org and is
// isolated from every other account by users.organisation_id.
// ============================================================================
import crypto from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { agencyRepository } from '../repositories/agency.repository.js';
import { authRepository } from '../repositories/auth.repository.js';
import { authService } from './auth.service.js';
import { featuresService } from './features.service.js';
import { orgMetaService } from './org-meta.service.js';
import { signSwitchToken, SWITCH_TTL_MS } from '../lib/agency-switch.js';

async function assertChild(agencyOrgId, subOrgId) {
    const children = await agencyRepository.childOrgs(agencyOrgId);
    const child = children.find((c) => c.id === subOrgId);
    if (!child) throw new AppError('Not a sub-account of your organisation', 404);
    return child;
}

export const agencyService = {
    async listSubaccounts(agencyOrgId) {
        const children = await agencyRepository.childOrgs(agencyOrgId);
        const integrations = await agencyRepository.orgIntegrations(children.map((c) => c.id));
        const subaccounts = await Promise.all(children.map(async (c) => ({
            ...c,
            integrations: integrations
                .filter((i) => i.organisation_id === c.id)
                .map(({ provider, status }) => ({ provider, status })),
            features: await featuresService.getEffectiveFeatures(c.id),
        })));
        return { subaccounts };
    },

    // Creates the ORGANISATION only. No owner, no temporary password to hand
    // over — the agency adds users afterwards with a password it sets.
    async createSubaccount(agencyOrgId, body) {
        const base = body.organisation_name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
        let { data, error } = await agencyRepository.createOrg(body.organisation_name, base, agencyOrgId);
        // organisations.slug is UNIQUE and name-derived; two practices with the
        // same name are routine for an agency, so retry once with a suffix.
        if (error?.code === '23505') {
            const suffixed = `${base.slice(0, 34)}-${crypto.randomBytes(3).toString('hex')}`;
            ({ data, error } = await agencyRepository.createOrg(body.organisation_name, suffixed, agencyOrgId));
        }
        if (error) throw new AppError(error.message, 400);
        orgMetaService.invalidate(data.id);
        return { organisation_id: data.id, name: data.name };
    },

    async listSubaccountUsers(agencyOrgId, subOrgId) {
        await assertChild(agencyOrgId, subOrgId);
        return { users: await agencyRepository.listOrgUsers(subOrgId) };
    },

    // Add a user to ONE sub-account. users.organisation_id is single-valued,
    // so the account is isolated to that org by construction. The password is
    // permanent — set by the agency, no forced change on first login.
    async addSubaccountUser(agencyOrgId, subOrgId, actor, body) {
        await assertChild(agencyOrgId, subOrgId);
        // provisionMember gates on the CALLER's role hierarchy. The agency
        // admin is acting as that org's owner, which is the ceiling here.
        const caller = { id: actor?.id ?? null, role: 'owner', permissions: {} };
        const out = await authService.provisionMember(subOrgId, caller, { ...body, permissions: {} });
        return { user_id: out.user_id, email: body.email, role: body.role };
    },

    // IRREVERSIBLE: organisations cascades every business table. Guarded by
    // child-of-agency AND an exact name echo, so a mis-clicked id cannot
    // destroy a tenant. Auth identities are removed explicitly — the cascade
    // only reaches public.users and would otherwise leave orphans.
    async deleteSubaccount(agencyOrgId, subOrgId, confirmName) {
        const child = await assertChild(agencyOrgId, subOrgId);
        const given = String(confirmName ?? '').trim().toLowerCase();
        if (given !== child.name.trim().toLowerCase()) {
            throw new AppError('Type the organisation name exactly to confirm deletion', 400);
        }
        const userIds = await agencyRepository.orgUserIds(subOrgId);
        await agencyRepository.deleteOrg(subOrgId);
        for (const id of userIds) {
            try {
                await authRepository.deleteAuthUser(id);
            } catch (err) {
                // The org is already gone; a stuck auth row is an orphan to
                // clean up, not a reason to fail the delete.
                console.error('[agency] auth identity delete failed:', id, err?.message || err);
            }
        }
        orgMetaService.invalidate(subOrgId);
        featuresService.invalidate(subOrgId);
        return { deleted: subOrgId, users: userIds.length };
    },

    async subaccountFeatures(agencyOrgId, subOrgId) {
        await assertChild(agencyOrgId, subOrgId);
        const [features, overrides] = await Promise.all([
            featuresService.getEffectiveFeatures(subOrgId),
            agencyRepository.featureRows(subOrgId),
        ]);
        return { features, overrides };
    },

    async setSubaccountFeature(agencyOrgId, subOrgId, { feature, enabled }) {
        await assertChild(agencyOrgId, subOrgId);
        await agencyRepository.upsertFeature(subOrgId, feature, enabled);
        featuresService.invalidate(subOrgId);
        return { features: await featuresService.getEffectiveFeatures(subOrgId) };
    },

    async switch(agencyOrgId, userId, targetOrgId) {
        const child = await assertChild(agencyOrgId, targetOrgId);
        const token = signSwitchToken(userId, targetOrgId);
        return {
            token,
            expires_at: new Date(Date.now() + SWITCH_TTL_MS).toISOString(),
            organisation: { id: child.id, name: child.name },
        };
    },
};
