import { api } from '@/lib/api';

// Per-org chair-capacity config (Intelligence OS — Chair Efficiency, Phase 3 /
// T12). GET returns the saved row overlaid on the CHAIR_CONFIG code defaults
// (always full; isDefault:true when never configured). PUT upserts it
// (finance.edit, audited) and feeds GET /chair capacity. benchRevHrPence is
// integer pence; the rest are plain counts/percentages.

export interface ChairConfig {
  openHrs: number;
  weeksYr: number;
  daysWk: number;
  benchOccPct: number;
  benchRevHrPence: number;
  isDefault?: boolean;
  updatedAt?: string | null;
}

export function getChairConfig(): Promise<ChairConfig> {
  return api<ChairConfig>('/api/analytics/chair-config');
}

export function saveChairConfig(cfg: ChairConfig): Promise<ChairConfig> {
  return api<ChairConfig>('/api/analytics/chair-config', {
    method: 'PUT',
    body: JSON.stringify({
      openHrs: cfg.openHrs,
      weeksYr: cfg.weeksYr,
      daysWk: cfg.daysWk,
      benchOccPct: cfg.benchOccPct,
      benchRevHrPence: cfg.benchRevHrPence,
    }),
  });
}
