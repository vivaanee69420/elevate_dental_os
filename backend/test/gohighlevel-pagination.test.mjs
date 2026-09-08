// ============================================================================
// GoHighLevel paged walks.
//
// The walk used to stop on a SHORT page: `items.length < PER_PAGE` was treated
// as "no more rows". GoHighLevel filters server-side AFTER taking a page, so a
// page can come back short with rows still to come, and the walk ended early
// with nothing said about it.
//
// Measured on live data: gm dental Rochester's location holds 9,487 contacts
// and we had 9,422 — 94 full pages of 100, then a page of 22 that ended the
// walk. The owner found the 65 by counting in GoHighLevel by hand, which is
// the only way a silent truncation is ever found.
//
// These tests are about WHEN THE WALK STOPS. They deliberately assert the
// number of pages FETCHED as well as the rows returned: a walk that stopped
// early would still return a plausible-looking array, which is what made the
// original bug invisible.
// ============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ghlFetchAll } from '../src/lib/integrations/gohighlevel-sync.js';

const PER_PAGE = 100;

/** A page of `n` synthetic rows. No patient fields: identity only. */
const rows = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${from + i}` }));

/**
 * Stub `fetch` with a scripted sequence of GHL responses. Records every URL so
 * a test can assert how many pages were actually requested.
 */
function stubPages(pages) {
    const urls = [];
    let call = 0;
    vi.stubGlobal('fetch', async (url) => {
        urls.push(String(url));
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => page,
        };
    });
    return urls;
}

const cursor = (n) => ({ startAfter: 1000 + n, startAfterId: `c${n}` });

afterEach(() => vi.unstubAllGlobals());

describe('ghlFetchAll', () => {
    // THE BUG. A short page in the middle of a collection must not end the
    // walk — GoHighLevel returns them routinely.
    it('keeps walking after a SHORT page when rows remain', async () => {
        const urls = stubPages([
            { contacts: rows(PER_PAGE, 0), meta: { total: 222, ...cursor(1) } },
            // 22 rows, well under the page size, but 100 more still to come.
            { contacts: rows(22, 100), meta: { total: 222, ...cursor(2) } },
            { contacts: rows(100, 122), meta: { total: 222, ...cursor(3) } },
            { contacts: [], meta: { total: 222 } },
        ]);
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(out).toHaveLength(222);
        // THREE requests, not four: the short page did not end the walk, and
        // the third page reached meta.total so the fourth was never needed.
        // Stopping at the total is the point — the walk costs no more requests
        // than before, it just no longer stops for the wrong reason.
        expect(urls).toHaveLength(3);
    });

    // The old stop condition, as a regression pin: exactly the live shape.
    it('does not stop 65 rows early on the shape that lost them', async () => {
        const pages = [];
        for (let p = 0; p < 94; p++) pages.push({ contacts: rows(PER_PAGE, p * 100), meta: { total: 9487, ...cursor(p) } });
        pages.push({ contacts: rows(22, 9400), meta: { total: 9487, ...cursor(94) } }); // the short page
        pages.push({ contacts: rows(65, 9422), meta: { total: 9487, ...cursor(95) } });
        pages.push({ contacts: [], meta: { total: 9487 } });
        stubPages(pages);
        // 500 pages, matching what pullContacts passes (CONTACT_MAX_PAGES).
        // The bare default is 50 — at 100 rows a page that caps a contact walk
        // at 5,000, which is its own silent truncation on an org this size.
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts', maxPages: 500 });
        expect(out).toHaveLength(9487);
        expect(out.length).not.toBe(9422);
    });

    // meta.total is GoHighLevel's own count. It was read for a progress bar
    // while the completeness decision ignored it; now it ends the walk, so a
    // complete pull costs no extra request.
    it('stops as soon as the API’s own total is reached', async () => {
        const urls = stubPages([
            { contacts: rows(PER_PAGE, 0), meta: { total: 150, ...cursor(1) } },
            { contacts: rows(50, 100), meta: { total: 150, ...cursor(2) } },
            { contacts: rows(50, 150), meta: { total: 150, ...cursor(3) } }, // must never be asked for
        ]);
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(out).toHaveLength(150);
        expect(urls).toHaveLength(2);
    });

    // An empty page is the honest end of a collection whose total is unknown.
    it('stops on an empty page when the API reports no total', async () => {
        const urls = stubPages([
            { contacts: rows(PER_PAGE, 0), meta: { ...cursor(1) } },
            { contacts: rows(30, 100), meta: { ...cursor(2) } },
            { contacts: [], meta: {} },
        ]);
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(out).toHaveLength(130);
        expect(urls).toHaveLength(3);
    });

    // No cursor and no next link means there is no way to ask for more. Stop
    // rather than re-request page one forever.
    it('stops when the cursor is exhausted', async () => {
        const urls = stubPages([
            { contacts: rows(PER_PAGE, 0), meta: { total: 500 } }, // full page, no cursor
        ]);
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(out).toHaveLength(100);
        expect(urls).toHaveLength(1);
    });

    // A truncated walk must SAY SO. Silence is what let this run for months.
    it('warns when it ends below the total the API reported', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubPages([{ contacts: rows(100, 0), meta: { total: 9487 } }]); // cursor exhausted early
        await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(warn).toHaveBeenCalled();
        expect(String(warn.mock.calls[0][0])).toMatch(/100 of 9487/);
        warn.mockRestore();
    });

    it('does not warn when the walk completes', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubPages([
            { contacts: rows(100, 0), meta: { total: 150, ...cursor(1) } },
            { contacts: rows(50, 100), meta: { total: 150, ...cursor(2) } },
        ]);
        await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts' });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    // The runaway guard still holds when the API never says it is finished.
    it('still respects the page cap', async () => {
        const urls = stubPages([
            { contacts: rows(PER_PAGE, 0), meta: { total: 1_000_000, ...cursor(1) } },
        ]);
        const out = await ghlFetchAll('/contacts/', 'tok', 'loc', { arrayKey: 'contacts', maxPages: 3 });
        expect(urls).toHaveLength(3);
        expect(out).toHaveLength(300);
    });
});
