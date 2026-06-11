'use client';
// Read-only patient detail dialog. Opened by clicking a patient row on the
// Practices & Patients screen. Fetches the full contact record + curated
// Dentally patient blob (GET /api/growth/practice-patients/:id) on open.
//
// `detail` (contacts.pms_patient) is null for non-Dentally contacts and for
// patients not yet re-synced since migration 000082 — in that case we fall back
// to the typed columns we already hold and show an explanatory note.

import { usePatientDetail } from '../hooks';
import { Skeleton } from '@/components/ui';

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const t = Date.parse(d);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtRecall(interval: number | null | undefined): string {
  if (interval == null || interval <= 0) return '—';
  return `${interval} month${interval === 1 ? '' : 's'}`;
}

function yesNo(v: boolean | null | undefined): string {
  if (v == null) return '—';
  return v ? 'Yes' : 'No';
}

/** One label/value pair. Renders an em-dash for empty values. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value == null || value === '' || value === '—';
  return (
    <div>
      <div className="text-xs text-ink-muted uppercase" style={{ letterSpacing: '0.02em' }}>{label}</div>
      <div className="text-sm mt-0.5" style={{ color: empty ? 'var(--ink-muted)' : undefined }}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

/** A titled group of fields in a 2-up grid. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="text-xs font-bold uppercase text-ink-muted" style={{ marginBottom: 8, letterSpacing: '0.04em' }}>
        {title}
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {children}
      </div>
    </div>
  );
}

interface Props {
  patientId: string | null;
  onClose: () => void;
}

export default function PatientDetailModal({ patientId, onClose }: Props) {
  const { data, isLoading, error } = usePatientDetail(patientId);
  if (!patientId) return null;

  const d = data?.detail ?? null;
  // Prefer the Dentally blob; fall back to the typed columns we always hold.
  const name = data?.name || [d?.first_name, d?.last_name].filter(Boolean).join(' ') || 'Patient';
  const gender = d?.gender == null ? '—' : d.gender ? 'Male' : 'Female';
  const address = [d?.address_line_1 ?? data?.address, d?.address_line_2, d?.town, d?.county, d?.postcode ?? data?.postcode]
    .filter(Boolean)
    .join(', ') || '—';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="card-padded"
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', maxWidth: 640, width: '100%', maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div className="flex justify-between items-start" style={{ marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>{name}</h3>
            {data?.pms_external_id && (
              <p className="text-ink-muted" style={{ fontSize: 11, marginTop: 2 }}>
                Dentally ID {data.pms_external_id}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'white', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>

        {isLoading && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        )}

        {error && <div className="text-rose-600 text-sm">Could not load patient details.</div>}

        {!isLoading && !error && data && (
          <>
            {d?.medical_alert && (
              <div
                className="text-sm"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}
              >
                <strong>Medical alert.</strong>{' '}
                {d.medical_alert_text ? d.medical_alert_text : 'This patient has a flagged medical condition.'}
              </div>
            )}

            <Section title="Personal">
              <Field label="Title" value={d?.title} />
              <Field label="Preferred name" value={d?.preferred_name} />
              <Field label="Date of birth" value={fmtDate(d?.date_of_birth ?? data.date_of_birth)} />
              <Field label="Gender" value={gender} />
              <Field label="Occupation" value={d?.occupation} />
              <Field label="Status" value={d?.active == null ? '—' : d.active ? 'Active' : 'Archived'} />
            </Section>

            <Section title="Contact">
              <Field label="Email" value={d?.email_address ?? data.email} />
              <Field label="Mobile" value={d?.mobile_phone ?? data.phone} />
              <Field label="Home phone" value={d?.home_phone} />
              <Field label="Work phone" value={d?.work_phone} />
              <Field label="Address" value={address} />
              <Field label="Recall method" value={d?.recall_method} />
            </Section>

            <Section title="Recalls">
              <Field label="Dentist recall due" value={fmtDate(d?.dentist_recall_date ?? data.next_recall_date)} />
              <Field label="Dentist interval" value={fmtRecall(d?.dentist_recall_interval)} />
              <Field label="Hygienist recall due" value={fmtDate(d?.hygienist_recall_date)} />
              <Field label="Hygienist interval" value={fmtRecall(d?.hygienist_recall_interval)} />
              <Field label="Last visit" value={fmtDate(data.last_visit_date)} />
            </Section>

            <Section title="Identifiers & consent">
              <Field label="NHS number" value={d?.nhs_number} />
              <Field label="NI number" value={d?.ni_number} />
              <Field label="Marketing" value={d?.marketing == null ? '—' : (d.marketing ? 'Opted in' : 'Opted out')} />
              <Field label="Email consent" value={yesNo(d?.use_email)} />
              <Field label="SMS consent" value={yesNo(d?.use_sms)} />
            </Section>

            {(d?.emergency_contact_name || d?.emergency_contact_phone) && (
              <Section title="Emergency contact">
                <Field label="Name" value={d?.emergency_contact_name} />
                <Field label="Relationship" value={d?.emergency_contact_relationship} />
                <Field label="Phone" value={d?.emergency_contact_phone} />
              </Section>
            )}

            <Section title="Record">
              <Field label="Source" value={data.source} />
              <Field label="Added" value={fmtDate(data.created_at)} />
            </Section>

            {!d && (
              <p className="text-ink-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Full Dentally detail will appear here once this patient is re-synced.
                Showing the basic record we currently hold.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
