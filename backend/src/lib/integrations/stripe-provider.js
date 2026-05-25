// Stripe Connect provider — OAuth-style. Real impl would use stripe-node SDK
// (`new Stripe(...).oauth.token(...)`). Scaffolded here to prove the pattern.

import { registerProvider, NotImplementedError } from './provider-interface.js';
import { integrationRepository as integrationsRepository } from '../../repositories/integration.repository.js';
import { encryptSecret } from '../crypto.js';

const STRIPE_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID;
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

const impl = {
    async authorize(orgId) {
        if (!STRIPE_CLIENT_ID) throw new Error('STRIPE_CONNECT_CLIENT_ID not configured');
        const state = Buffer.from(JSON.stringify({ orgId, ts: Date.now() })).toString('base64url');
        const url = new URL('https://connect.stripe.com/oauth/authorize');
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', STRIPE_CLIENT_ID);
        url.searchParams.set('scope', 'read_write');
        url.searchParams.set('state', state);
        url.searchParams.set('redirect_uri', `${APP_URL}/api/integrations/stripe/callback`);
        await integrationsRepository.upsert(orgId, 'stripe', { status: 'pending' });
        return { redirectUrl: url.toString() };
    },

    async callback(orgId, { code }) {
        if (!STRIPE_SECRET) throw new Error('STRIPE_SECRET_KEY not configured');
        const res = await fetch('https://connect.stripe.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_secret: STRIPE_SECRET,
                code,
                grant_type: 'authorization_code',
            }).toString(),
        });
        const body = await res.json();
        if (!res.ok) {
            await integrationsRepository.markFailed(orgId, 'stripe', body.error_description ?? 'oauth_failed');
            throw new Error(body.error_description ?? 'Stripe OAuth failed');
        }
        await integrationsRepository.upsertSecrets(orgId, 'stripe', {
            config: { stripe_user_id: body.stripe_user_id, scope: body.scope },
            secrets: encryptSecret(JSON.stringify({
                access_token: body.access_token,
                refresh_token: body.refresh_token,
                stripe_publishable_key: body.stripe_publishable_key,
            })),
            status: 'active',
            verified_at: new Date().toISOString(),
            scopes: body.scope ? [body.scope] : null,
        });
        return { ok: true };
    },

    async refresh(_orgId) {
        // Stripe Connect refresh: POST oauth/token grant_type=refresh_token
        throw new NotImplementedError('stripe.refresh — Stripe Connect tokens are long-lived');
    },

    async revoke(orgId) {
        await integrationsRepository.markRevoked(orgId, 'stripe');
        return { ok: true };
    },

    async webhook(payload, _signature) {
        // In real impl: stripe.webhooks.constructEvent(rawBody, sig, endpointSecret)
        // Then route by event.type → payments/subscriptions/etc.
        return { received: true, type: payload?.type ?? 'unknown' };
    },

    async sync(_orgId) {
        throw new NotImplementedError('stripe.sync — Stripe uses webhooks, not polling');
    },
};

registerProvider(
    { id: 'stripe', label: 'Stripe', authStyle: 'oauth', category: 'payments' },
    impl,
);
