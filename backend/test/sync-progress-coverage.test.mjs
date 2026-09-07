// Every syncer must report progress.
//
// google_ads, meta_ads and xero named the callback `_onProgress` — the
// underscore convention for "deliberately unused" — and never called it. The
// overlay therefore sat on "Starting… 0%" for the entire run, so a healthy
// Google Ads pull that landed 2,961 metric rows was indistinguishable on screen
// from one that had died at the first request. The owner reported it as stuck.
//
// This is a structural test rather than a behavioural one on purpose: the bug
// was not a wrong number, it was a callback nobody called, and that is visible
// in the source and nowhere else.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SYNCERS = [
    'dentally-sync',
    'gohighlevel-sync',
    'google-ads-sync',
    'meta-ads-sync',
    'quickbooks-sync',
    'xero-sync',
];

const src = (name) => readFileSync(new URL(`../src/lib/integrations/${name}.js`, import.meta.url), 'utf8');

describe('sync progress reporting', () => {
    it.each(SYNCERS)('%s takes the progress callback seriously', (name) => {
        const s = src(name);
        const sig = /export async function syncOneOrg\(([^)]*)\)/.exec(s);
        expect(sig, `${name} has no syncOneOrg`).toBeTruthy();
        // `_onProgress` is the convention for a parameter that is never used.
        // On a syncer that is not a style choice, it is a silent progress bar.
        expect(sig[1], `${name} accepts the callback but marks it unused`)
            .not.toContain('_onProgress');
    });

    it.each(SYNCERS)('%s actually emits progress somewhere', (name) => {
        // Optional-call syntax counts: quickbooks reports via `onProgress?.(`,
        // which a naive search for `onProgress(` misses — that near-miss is why
        // QuickBooks was briefly suspected of the same fault it never had.
        const emissions = src(name).match(/\b(onProgress|report)\s*\??\.?\(/g) ?? [];
        expect(emissions.length, `${name} never calls its progress callback`).toBeGreaterThan(0);
    });
});
