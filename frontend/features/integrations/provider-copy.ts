// Tile copy for the Integrations grid.
//
// Descriptions are presentation strings, so they live here rather than in the
// backend provider registry: two of the tiles (CallRail, Emergent) are not
// registry providers at all, and the Google tile is one card covering three
// separate registry providers, so registry metadata could never have been the
// single source anyway. British English throughout (project rule 4).

export interface ProviderCopy {
  label: string;
  description: string;
}

export const PROVIDER_COPY: Record<string, ProviderCopy> = {
  google: {
    label: 'Google',
    description:
      'Connect your Google account for Ads campaign performance, call-reporting sheets, and conversion export back to Sheets.',
  },
  dentally: {
    label: 'Dentally',
    description:
      'Sync patients, appointments, treatment plans and payments from your practice management system.',
  },
  gohighlevel: {
    label: 'GoHighLevel',
    description:
      'Pull contacts, opportunities and conversations from every subaccount into your CRM and lead pipeline.',
  },
  meta_ads: {
    label: 'Meta Ads',
    description:
      'Track Facebook and Instagram campaign spend, reach and conversions against the leads they produce.',
  },
  quickbooks: {
    label: 'QuickBooks',
    description:
      'Bring profit and loss, bank balances, outstanding invoices and receipts in from every company you run.',
  },
  xero: {
    label: 'Xero',
    description:
      'Sync Xero contacts and accounts without manual data entry or time-consuming imports.',
  },
  callrail: {
    label: 'CallRail',
    description:
      'Attribute tracked phone calls to the campaigns that drove them, company by company.',
  },
  emergent: {
    label: 'Emergent',
    description:
      'Ingest the treatment acceptances your team logs in the Emergent ops app, in real time.',
  },
  soe: {
    label: 'Software of Excellence',
    description:
      'Connect your SOE/Exact practice management system with an API key from your practice settings.',
  },
};

// The three Google connections behind the single Google tile. They stay three
// separate backend integrations on purpose — each holds a different OAuth
// scope, and the read-only Call Reporting grant must not be widened by the
// read/write export grant — so the tile offers three connections, not one.
export const GOOGLE_SERVICE_IDS = ['google_ads', 'google_sheets', 'google_sheets_writer'] as const;

export const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  google_ads: 'Google Ads',
  google_sheets: 'Google Sheets — Call Reporting',
  google_sheets_writer: 'Google Sheets — Conversion Export',
};

export function copyFor(id: string, fallbackLabel: string): ProviderCopy {
  return PROVIDER_COPY[id] ?? { label: fallbackLabel, description: '' };
}
