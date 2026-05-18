#!/usr/bin/env tsx
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Seed a new tenant for sales demos
// Usage: tsx scripts/seed-tenant.ts --name "Demo Dental" --email "owner@example.com"
const supabase_js_1 = require("@supabase/supabase-js");
const args = process.argv.slice(2);
const name = args[args.indexOf('--name') + 1];
const email = args[args.indexOf('--email') + 1];
if (!name || !email) {
    console.error('Usage: tsx scripts/seed-tenant.ts --name "Org Name" --email "owner@example.com"');
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function main() {
    // 1. Create org
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const { data: org } = await supabase
        .from('organisations')
        .insert({ name, slug, subscription_plan: 'trial' })
        .select()
        .single();
    if (!org)
        throw new Error('Failed to create org');
    console.log(`✓ Created org: ${org.id}`);
    // 2. Create auth user
    const password = Math.random().toString(36).slice(2, 14) + 'A1!';
    const { data: authData } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });
    if (!authData.user)
        throw new Error('Failed to create user');
    // 3. Create users row
    await supabase.from('users').insert({
        id: authData.user.id,
        organisation_id: org.id,
        email,
        full_name: name + ' Owner',
        role: 'owner',
    });
    console.log(`✓ Created owner user: ${email}`);
    // 4. Default membership plans
    await supabase.from('membership_plans').insert([
        { organisation_id: org.id, name: 'Smile Club Essential', monthly_price_pence: 1495,
            benefits: ['2 hygiene visits/year', 'Annual exam', '10% off treatments'] },
        { organisation_id: org.id, name: 'Smile Club Plus', monthly_price_pence: 2495,
            benefits: ['4 hygiene visits/year', 'Annual exam', '15% off treatments'] },
    ]);
    // 5. Default practice
    await supabase.from('practices').insert({
        organisation_id: org.id,
        name: name + ' Main',
        chairs: 4,
    });
    console.log('\n🎉 Tenant ready');
    console.log(`   Org ID:   ${org.id}`);
    console.log(`   Email:    ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Login:    https://app.elevate.app/login`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
