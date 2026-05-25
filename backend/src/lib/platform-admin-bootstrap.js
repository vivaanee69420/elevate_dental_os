// ============================================================================
// Bootstrap first platform admin from env if the table is empty. Idempotent.
// Reads PLATFORM_ADMIN_BOOTSTRAP_EMAIL and PLATFORM_ADMIN_BOOTSTRAP_PASSWORD.
// New admin is created with must_change_password=true so the env-vars
// password is rotated on first login.
// ============================================================================

import bcrypt from 'bcryptjs';
import { platformAdminRepository } from '../repositories/platform-admin.repository.js';

export async function bootstrapPlatformAdmin(log = console) {
  const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    log.info?.({ msg: '[platform] bootstrap skipped (env not set)' }) ??
      log.log?.('[platform] bootstrap skipped (env not set)');
    return;
  }

  try {
    const existing = await platformAdminRepository.count();
    if (existing > 0) return;

    const password_hash = await bcrypt.hash(password, 12);
    await platformAdminRepository.insert({
      email,
      password_hash,
      full_name: 'Bootstrap Admin',
      role: 'superadmin',
      must_change_password: true,
    });
    (log.info ?? log.log)?.(`[platform] bootstrapped first superadmin: ${email}`);
  } catch (err) {
    (log.error ?? log.log)?.({ err }, '[platform] bootstrap failed');
  }
}
