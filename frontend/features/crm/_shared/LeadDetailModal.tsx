'use client';
// One lead-detail dialog, shared by every CRM screen that shows leads.
//
// Today had its own copy and Pipeline had none — clicking a pipeline card did
// nothing at all. Two copies of "what does this lead say" would be two places
// to forget that `leads.treatment` must never be rendered, so there is one.

import { useEffect, useRef } from 'react';
import type { Lead } from '@/features/leads/api';
import { money, DASH } from '@/features/marketing/_shared/format';

export function leadDisplayName(l: Lead): string {
  const n = `${l.contact?.first_name ?? ''} ${l.contact?.last_name ?? ''}`.trim();
  return n || `Lead ${l.id.slice(0, 8)}`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 text-[13px] last:border-0">
      <span className="text-ink-muted shrink-0">{label}</span>
      <span className="text-right font-semibold break-words">{value}</span>
    </div>
  );
}

export function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and the page behind does not scroll while the dialog is
  // open — without this the board scrolls under the overlay, which reads as
  // the click having gone somewhere unintended.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="presentation"
      className="crm-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Lead: ${leadDisplayName(lead)}`}
        className="crm-dialog card-padded relative max-h-[85vh] w-full max-w-[520px] overflow-y-auto bg-card shadow-panel"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-2.5 rounded-md px-1.5 text-xl leading-none text-ink-muted transition-colors hover:bg-bg hover:text-ink"
        >
          ×
        </button>

        <h3 className="mb-1 pr-8 text-lg font-bold">{leadDisplayName(lead)}</h3>
        <p className="text-ink-muted mb-3 text-xs">
          {lead.ghl_stage_name ?? lead.status.replace(/_/g, ' ')}
        </p>

        <Field label="Email" value={lead.contact?.email || DASH} />
        <Field label="Phone" value={lead.contact?.phone || DASH} />
        {/* A "Treatment" field stood here on Today. It rendered
            `leads.treatment`, which is GoHighLevel's raw opportunity name and
            carries patient names, emails and phone numbers on live data. The
            stage says where the lead is, truthfully. */}
        <Field label="Stage" value={lead.ghl_stage_name ?? lead.status.replace(/_/g, ' ')} />
        <Field label="Status" value={lead.status.replace(/_/g, ' ')} />
        {/* money() renders null as an em dash. Most leads carry no estimated
            value, and "£0.00" states a figure nobody recorded. */}
        <Field label="Value" value={money(lead.estimated_value_pence || null)} />
        <Field label="Source" value={lead.source || DASH} />
        <Field label="Created" value={new Date(lead.created_at).toLocaleString('en-GB')} />
        <Field
          label="Synced from"
          value={lead.sync_status === 'synced' ? 'GoHighLevel' : 'Manual entry'}
        />
      </div>
    </div>
  );
}
