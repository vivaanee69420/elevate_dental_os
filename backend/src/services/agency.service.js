// ============================================================================
// Agency → sub-account lifecycle. Every child-targeting call re-validates
// child-of-agency via childOrgs (no trust in caller-supplied ids). Owner
// provisioning REUSES provisionOrgOwner — one implementation for platform
// create-org, self-signup and agency create (same temp-password contract as
// the platform path: surfaced once, never persisted).
// ============================================================================
import crypto from 'node:crypto';
import { AppError } from '../middleware/errors.js';
import { agencyRepository } from '../repositories/agency.repository.js';
import { provisionOrgOwner } from './auth.service.js';
import { featuresService } from './features.service.js';
import { orgMetaService } from './org-meta.service.js';
import { signSwitchToken, SWITCH_TTL_MS } from '../lib/agency-switch.js';

// One-time handover credential — same shape as the platform create-org path.
function generateTempPassword() {
    return crypto.randomBytes(12).toString('base64url');
}

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

    async createSubaccount(agencyOrgId, body) {
        const password = generateTempPassword();
        const { organisation_id, owner_id } = await provisionOrgOwner(
            {
                organisation_name: body.organisation_name,
                email: body.owner_email,
                full_name: body.owner_name,
                password,
            },
            'active',
        );
        await agencyRepository.setParent(organisation_id, agencyOrgId);
        orgMetaService.invalidate(organisation_id);
        return { organisation_id, owner_id, owner_email: body.owner_email, temp_password: password };
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
