import { z } from 'zod';

export const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const platformChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(12, 'Password must be at least 12 characters'),
});

export const listOrgsQuerySchema = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const orgIdParamSchema = z.object({
  id: z.string().uuid(),
});

// Platform admin creates a tenant org + owner. No password field — the
// backend generates a one-time temp password and returns it once.
export const createOrgSchema = z.object({
  email: z.string().email(),
  full_name: z.string().trim().min(1),
  organisation_name: z.string().trim().min(1),
});

// :id route param for the signup approve/reject actions (the owner user id).
export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const userSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const auditQuerySchema = z.object({
  organisation_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const metricsRangeQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});
