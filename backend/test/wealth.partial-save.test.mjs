// ============================================================================
// Saving the Exit Plan must not wipe the personal balance sheet.
//
// The Exit Plan screen sends only { exit }. wealthInputsSchema defaults the
// four balance-sheet arrays to [], so before this was fixed the service wrote
// assets/liabilities/pensions/properties as empty arrays and sale as {} on
// every Exit Plan save — silently destroying everything the Wealth screen had
// stored. Nothing errored, and the screen reported success.
// ============================================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wealthService } from '../src/services/wealth.service.js';
import { wealthRepository } from '../src/repositories/wealth.repository.js';

const ORG = 'org-1';

const EXISTING = {
    assets: [{ name: 'ISA', valuePence: 5_000_00, type: 'Investments', growthPct: 5, liquid: true }],
    liabilities: [{ name: 'Mortgage', balancePence: 250_000_00 }],
    pensions: [{ name: 'SIPP', valuePence: 90_000_00 }],
    properties: [{ name: 'Home', valuePence: 400_000_00 }],
    sale: { enterpriseValuePence: 1_000_000_00 },
    fire: { retireAge: 57 },
};

describe('wealthService.saveInputs — partial saves', () => {
    let origUpsert, origGet, written;

    beforeEach(() => {
        written = null;
        origUpsert = wealthRepository.upsert;
        origGet = wealthRepository.get;
        wealthRepository.upsert = async (_org, fields) => { written = fields; return fields; };
        wealthRepository.get = async () => ({ ...EXISTING });
    });
    afterEach(() => {
        wealthRepository.upsert = origUpsert;
        wealthRepository.get = origGet;
    });

    it('writes ONLY the exit plan when only the exit plan was sent', async () => {
        await wealthService.saveInputs(ORG, { exit: { retireAge: 60 } }, 'user-1');

        expect(written.fire).toEqual({ retireAge: 60 });
        // The four balance-sheet sections and the sale block must be absent from
        // the write entirely — an empty array here is a destructive UPDATE, not
        // a no-op.
        for (const key of ['assets', 'liabilities', 'pensions', 'properties', 'sale']) {
            expect(written, `${key} must not be written by an exit-only save`).not.toHaveProperty(key);
        }
    });

    it('writes ONLY the balance sheet when the exit plan was not sent', async () => {
        await wealthService.saveInputs(ORG, { assets: EXISTING.assets }, 'user-1');

        expect(written.assets).toEqual(EXISTING.assets);
        expect(written).not.toHaveProperty('fire');
    });

    it('still writes an explicitly emptied section', async () => {
        // Deleting your last asset is a real instruction and must persist. This
        // is why the fix keys off which sections were SENT, not off whether the
        // value is empty.
        await wealthService.saveInputs(ORG, { assets: [] }, 'user-1');
        expect(written.assets).toEqual([]);
    });

    it('writes every section when a full body is sent', async () => {
        await wealthService.saveInputs(ORG, {
            assets: [], liabilities: [], pensions: [], properties: [], exit: { retireAge: 55 },
        }, 'user-1');
        for (const key of ['assets', 'liabilities', 'pensions', 'properties']) {
            expect(written).toHaveProperty(key);
        }
        expect(written.fire).toEqual({ retireAge: 55 });
    });
});
