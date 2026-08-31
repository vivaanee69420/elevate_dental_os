// ============================================================================
// Agency-actor gates. An "agency actor" is the real user being an OWNER of an
// org with is_agency=true — whether acting at home or switched into a child
// (authenticate stamps req.agencyContext only after validating exactly that,
// so a switched context short-circuits true). requireAgencyOwner is the gate
// for /api/agency/* (handlers act on the HOME org via agencyHomeOrgId);
// requireAgencyActor gates mapping mutations (handlers act on the acting org).
// The predicate is identical today; two names keep intent readable and let
// the definitions diverge later without a route sweep.
// ============================================================================
import { orgMetaService } from '../services/org-meta.service.js';

export async function isAgencyActor(req) {
    if (req.agencyContext) return true;
    if (!req.user || req.user.role !== 'owner') return false;
    const meta = await orgMetaService.getOrgMeta(req.user.organisation_id);
    return meta?.is_agency === true;
}

// The caller's agency (home) org id — where /api/agency/* operations act.
export function agencyHomeOrgId(req) {
    return req.agencyContext?.homeOrgId ?? req.user.organisation_id;
}

// Named so the function is identifiable in stack traces and in the structural
// route tests that assert a mount carries the gate (a factory-returned arrow
// is anonymous otherwise).
function gate(name) {
    const fn = async (req, res, next) => {
        try {
            if (await isAgencyActor(req)) return next();
        } catch (err) {
            req.log?.warn({ err }, 'agency gate lookup failed');
        }
        return res.status(403).json({ error: 'Agency access required', code: 'AGENCY_ONLY' });
    };
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
}

export const requireAgencyActor = gate('requireAgencyActor');
export const requireAgencyOwner = gate('requireAgencyOwner');
