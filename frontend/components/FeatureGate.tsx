'use client';
import { useMe } from '@/hooks/useMe';

/**
 * Org-level feature gate (agency model). Renders children only when the org's
 * effective features include `feature`. `features === undefined` (backend
 * without the field yet) renders children — the API is the real boundary,
 * this is presentation. Loading renders nothing to avoid a flash.
 */
export function FeatureGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return null;
  const features = me?.features;
  if (features !== undefined && !features.includes(feature)) {
    return (
      <div className="card-padded" style={{ margin: 24 }}>
        <h2 className="display" style={{ fontSize: 18, marginBottom: 6 }}>Not available</h2>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          This feature is not enabled for your organisation.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
