-- Add integration_account_id to contacts, leads, and communications
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE SET NULL;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS integration_account_id UUID REFERENCES integration_accounts(id) ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_integration_account ON contacts(integration_account_id);
CREATE INDEX IF NOT EXISTS idx_leads_integration_account ON leads(integration_account_id);
CREATE INDEX IF NOT EXISTS idx_communications_integration_account ON communications(integration_account_id);

-- Backfill contacts and leads from mapped practices (legacy connection mapping fallback)
UPDATE contacts c
SET integration_account_id = a.id
FROM integration_accounts a
WHERE a.provider = 'gohighlevel'
  AND c.organisation_id = a.organisation_id
  AND c.source = 'gohighlevel'
  AND c.practice_id = a.practice_id;

UPDATE leads l
SET integration_account_id = a.id
FROM integration_accounts a
WHERE a.provider = 'gohighlevel'
  AND l.organisation_id = a.organisation_id
  AND l.ghl_opportunity_id IS NOT NULL
  AND l.practice_id = a.practice_id;

-- Backfill communications from contacts
UPDATE communications comm
SET integration_account_id = c.integration_account_id
FROM contacts c
WHERE c.id = comm.contact_id
  AND c.integration_account_id IS NOT NULL;

-- Backfill communications from leads (if not already backfilled via contact)
UPDATE communications comm
SET integration_account_id = l.integration_account_id
FROM leads l
WHERE l.id = comm.lead_id
  AND l.integration_account_id IS NOT NULL
  AND comm.integration_account_id IS NULL;

NOTIFY pgrst, 'reload schema';
