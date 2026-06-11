import { api } from '@/lib/api';
import { windowParams, type ResolvedWindow, type Scope } from '@/features/_shared/scope-context';

// Decision Lens (AI) — surface-specific "what to act on now" cards.
// GET /api/analytics/decision-lens?surface=&scope=&since=&until=&label=[&refresh=1]
// basis 'ai' => use items; 'unavailable' => caller renders its rule-based fallback.

export type LensSurface = 'group' | 'marketing' | 'clinicians' | 'day';
export type LensTone = 'good' | 'warn' | 'bad' | 'info';

export interface LensItem {
  tone: LensTone;
  title: string;
  body: string;
  value?: string;
}

export interface DecisionLensResp {
  basis: 'ai' | 'unavailable';
  cached?: boolean;
  generatedAt?: string;
  items: LensItem[];
}

const EMPTY: DecisionLensResp = { basis: 'unavailable', items: [] };

export function fetchDecisionLens(surface: LensSurface, scope: Scope, win: ResolvedWindow, refresh = false): Promise<DecisionLensResp> {
  const r = refresh ? '&refresh=1' : '';
  return api<DecisionLensResp>(`/api/analytics/decision-lens?surface=${surface}&${windowParams(scope, win)}${r}`)
    .then((d) => ({ ...EMPTY, ...d }))
    .catch(() => EMPTY);
}
