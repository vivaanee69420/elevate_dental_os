-- ============================================================================
-- ELEVATE DENTAL OS — Development Seed Data
-- ============================================================================
-- Creates: GM Dental Group org with 5 practices, 8 associates, sample data
-- Run AFTER 01_schema.sql and 02_rls.sql
-- ============================================================================

-- Create demo organisation
INSERT INTO organisations (id, name, slug, companies_house_number, subscription_plan, trial_ends_at)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'GM Dental Group',
  'gm-dental',
  '07852341',
  'group',
  NOW() + INTERVAL '365 days'
);

-- Create test users (UUIDs match Supabase auth.users created via the API)
-- NOTE: You must create these users in Supabase Auth first, then update IDs below

-- Owner: Gaurav
-- INSERT INTO auth.users via Supabase Admin API:
-- supabase.auth.admin.createUser({ email: 'gaurav@gmdental.uk', password: '...', email_confirm: true })
-- Then INSERT users record with same UUID:

-- Demo: assuming user IDs created
-- INSERT INTO users (id, organisation_id, email, full_name, role) VALUES
-- ('b1111111-...', 'a1111111-...', 'gaurav@gmdental.uk', 'Gaurav Mehta', 'owner'),
-- ('b2222222-...', 'a1111111-...', 'nadia@plan4growth.uk', 'Nadia Reinolds', 'owner'),
-- ('b3333333-...', 'a1111111-...', 'manager.warwick@gmdental.uk', 'Tom Brown', 'practice_manager'),
-- ('b4444444-...', 'a1111111-...', 'reception.ashford@gmdental.uk', 'Anna Smith', 'reception');

-- Practices
INSERT INTO practices (id, organisation_id, name, postcode, chairs, nhs_contract_uda) VALUES
('c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Ashford Dental', 'TN23 1QQ', 4, 8000),
('c2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'Rochester Dental', 'ME1 1XF', 4, 12000),
('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 'Barnet Dental', 'EN5 5AA', 3, 6000),
('c4444444-4444-4444-4444-444444444444', 'a1111111-1111-1111-1111-111111111111', 'Warwick Lodge Implant Centre', 'CT6 5SS', 4, 0),
('c5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111', 'Fixed Teeth Solutions Bexleyheath', 'DA7 4JJ', 3, 6000);

-- Default membership plans
INSERT INTO membership_plans (organisation_id, name, monthly_price_pence, benefits) VALUES
('a1111111-1111-1111-1111-111111111111', 'Smile Club Essential', 1495,
  '["2 hygiene visits/year", "Annual exam", "X-rays included", "10% off treatments"]'),
('a1111111-1111-1111-1111-111111111111', 'Smile Club Plus', 2495,
  '["4 hygiene visits/year", "Annual exam", "All X-rays", "15% off treatments", "Emergency cover"]'),
('a1111111-1111-1111-1111-111111111111', 'Smile Club Family', 3995,
  '["Up to 4 family members", "All Plus benefits"]');

-- Associates
INSERT INTO associates (organisation_id, primary_practice_id, full_name, email, joined_date, pay_pct, gdc_number, specialty) VALUES
('a1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', 'Dr Sarah Mitchell', 'sarah.mitchell@gmdental.uk', '2021-03-15', 5000, '123456', 'Implant dentistry'),
('a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'Dr James Roberts', 'james.roberts@gmdental.uk', '2019-07-01', 4700, '234567', 'General practice'),
('a1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'Dr Priya Sharma', 'priya.sharma@gmdental.uk', '2022-09-12', 4500, '345678', 'General practice'),
('a1111111-1111-1111-1111-111111111111', 'c5555555-5555-5555-5555-555555555555', 'Dr Michael Chen', 'michael.chen@gmdental.uk', '2020-11-03', 5000, '456789', 'Implant dentistry'),
('a1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333', 'Dr Emma Wilson', 'emma.wilson@gmdental.uk', '2023-02-20', 4500, '567890', 'General practice'),
('a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'Dr Thomas Brown', 'thomas.brown@gmdental.uk', '2018-04-10', 4800, '678901', 'Cosmetic'),
('a1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', 'Dr Aisha Khan', 'aisha.khan@gmdental.uk', '2022-01-08', 5000, '789012', 'Implant dentistry'),
('a1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'Dr Daniel Patel', 'daniel.patel@gmdental.uk', '2024-06-01', 4200, '890123', 'General practice');

-- Sample contacts (leads)
INSERT INTO contacts (organisation_id, practice_id, type, first_name, last_name, email, phone, source, marketing_consent) VALUES
('a1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', 'lead', 'John', 'Wallace', 'j.wallace@example.com', '07700900001', 'instagram', TRUE),
('a1111111-1111-1111-1111-111111111111', 'c4444444-4444-4444-4444-444444444444', 'lead', 'Sarah', 'Henderson', 's.henderson@example.com', '07700900002', 'google_ads', TRUE),
('a1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'lead', 'David', 'Thompson', 'd.thompson@example.com', '07700900003', 'referral', TRUE),
('a1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222', 'patient', 'Emma', 'Cooper', 'e.cooper@example.com', '07700900004', 'walk-in', TRUE),
('a1111111-1111-1111-1111-111111111111', 'c5555555-5555-5555-5555-555555555555', 'patient', 'Michael', 'Davies', 'm.davies@example.com', '07700900005', 'instagram', FALSE);

-- Sample leads with various statuses
WITH contact_ids AS (
  SELECT id, first_name, last_name, practice_id FROM contacts WHERE organisation_id = 'a1111111-1111-1111-1111-111111111111'
)
INSERT INTO leads (organisation_id, contact_id, practice_id, treatment, estimated_value_pence, status, source)
SELECT
  'a1111111-1111-1111-1111-111111111111',
  c.id,
  c.practice_id,
  treatment.name,
  treatment.value_pence,
  treatment.status,
  treatment.source
FROM contact_ids c
CROSS JOIN (VALUES
  ('All-on-4 Implants', 1450000, 'consultation_booked', 'instagram'),
  ('Single Tooth Implant', 285000, 'consultation_attended', 'google_ads'),
  ('Invisalign', 350000, 'treatment_started', 'referral')
) AS treatment(name, value_pence, status, source)
LIMIT 5;

-- Business health baseline (Gaurav's setup data)
INSERT INTO business_health (organisation_id, setup_step, setup_completed, setup_completed_at, baseline, targets)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  7,
  TRUE,
  NOW() - INTERVAL '30 days',
  '{
    "revenue": 4590000,
    "profit": 459000,
    "cash": 287000,
    "debt": 180000,
    "revenue_prior": 4180000,
    "profit_prior": 438000,
    "practices": 5,
    "chairs": 18,
    "associates": 8,
    "hygienists": 6,
    "nurses": 14,
    "admin": 10,
    "managers": 3,
    "utilisation": 78,
    "active_patients": 14820,
    "lapsed": 2380,
    "plan_members": 2600,
    "leads_per_month": 380,
    "new_per_month": 187,
    "conversion": 11.5,
    "case_value": 2850,
    "fta_rate": 4.2,
    "recall": 82,
    "private_pct": 72,
    "cost_associates": 42,
    "cost_lab": 10,
    "cost_materials": 6,
    "cost_staff": 17,
    "cost_property": 7,
    "cost_marketing": 4,
    "cost_other": 6
  }'::jsonb,
  '{
    "years": 3,
    "profit_multiple": 2.0,
    "target_revenue": 7500000,
    "target_practices": 7,
    "priority_profit": true,
    "priority_growth": true,
    "priority_owner": true,
    "exit_strategy": "hire_ceo"
  }'::jsonb
);

-- Baseline snapshot
INSERT INTO business_health_snapshots (organisation_id, snapshot_date, label, metrics)
VALUES (
  'a1111111-1111-1111-1111-111111111111',
  CURRENT_DATE - INTERVAL '30 days',
  'Baseline',
  '{
    "revenue": 4590000,
    "profit": 459000,
    "cash": 287000,
    "conversion": 11.5,
    "case_value": 2850,
    "fta_rate": 4.2,
    "chair_util": 78,
    "active_patients": 14820,
    "new_per_month": 187
  }'::jsonb
);
