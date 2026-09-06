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

// Agency access is a PER-USER grant (users.is_agency_admin), not "owner of an
// org that happens to be flagged is_agency". An agency org can hold both our
// staff and client users — Plan4growth does — so the org flag alone handed
// sub-account creation, practice mapping and production logs to real clients.
// The org flag now only says "may parent sub-accounts"; this says who may act.
export async function isAgencyActor(req) {
    // A switched context was already validated against the grant in
    // authenticate(), so it needs no second lookup.
    if (req.agencyContext) return true;
    return req.user?.is_agency_admin === true;
}

// The org /api/agency/* operates on: the single agency org, resolved in
// authenticate(). NOT the caller's own organisation_id — an agency admin may
// sit in a different org and still administer the agency's sub-accounts.
export function agencyHomeOrgId(req) {
    return req.agencyContext?.homeOrgId ?? req.agencyOrgId ?? req.user.organisation_id;
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

// Mapping a GHL pipeline is the one mapping a TENANT may do: an open day is
// their own event and waiting on their agency to categorise its pipeline would
// make the monthly routine unusable. Owner OR agency actor, never owner-only —
// an agency admin need not be an owner of the sub-account they administer.
//
// Subaccount -> practice and ad account -> practice stay requireAgencyActor:
// those decide how an agency's client data is attributed.
export async function requireOwnerOrAgencyActor(req, res, next) {
    if (req.user?.role === 'owner') return next();
    try {
        if (await isAgencyActor(req)) return next();
    } catch (err) {
        req.log?.warn({ err }, 'pipeline mapping gate lookup failed');
    }
    return res.status(403).json({ error: 'Owner or agency access required', code: 'OWNER_OR_AGENCY' });
}
