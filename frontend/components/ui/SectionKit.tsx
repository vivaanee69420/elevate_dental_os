'use client';
// Section presentation kit — a numbered section head, a section card, a KPI
// tile with a built-in "?" explainer and drill-down affordance, and the detail
// panel a drill-down opens into. Originally the Daily Command Cockpit skin
// (`elevate-cockpit-mockup_1.html`); promoted to shared UI so Ad Performance
// and the cockpit read as one product. No data logic lives here.
import { useState, type ReactNode } from 'react';
import s from './cockpit.module.css';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// A numbered green section circle + bold title, optional source chip and
// description — the mockup's `.sechead` / `.secnum` / `.secdesc`.
export function SecHead({
  n,
  title,
  desc,
  src,
  tone = 'green',
}: {
  n: number | string;
  title: ReactNode;
  desc?: ReactNode;
  src?: { label: string; ok?: boolean };
  tone?: 'green' | 'ok';
}) {
  return (
    <>
      <div className={s.sechead}>
        <span className={cx(s.secnum, tone === 'ok' && s.secnumOk)}>{n}</span>
        <span>
          {title}
          {src ? <span className={cx(s.src, src.ok && s.srcOk)}>{src.label}</span> : null}
        </span>
      </div>
      {desc ? <div className={s.secdesc}>{desc}</div> : null}
    </>
  );
}

export function SectionCard({ children }: { children: ReactNode }) {
  return <section className={s.card}>{children}</section>;
}

// Mint-tinted KPI tile — the mockup's `.kpi`. Keeps the drill-down affordance
// (onClick/active) and the "?" explainer we built on top of the mockup, both
// restyled to the green theme. `value` is pre-formatted; pass '—' for unknowns.
export function Kpi({
  label,
  value,
  note,
  noteTone = 'muted',
  tag,
  valueMuted,
  info,
  onClick,
  active,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: 'muted' | 'pos' | 'neg';
  tag?: { text: string; tone: 'pos' | 'neg' | 'amb' | 'muted' };
  valueMuted?: boolean;
  info?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clickable = Boolean(onClick);
  return (
    <div
      className={cx(s.kpi, clickable && s.kpiClickable, active && s.kpiActive)}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={clickable ? active : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className={s.lbl}>
        <span>{label}</span>
        {info ? (
          <button
            type="button"
            className={s.infoBtn}
            aria-label={open ? 'Hide explanation' : 'How is this calculated?'}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? '×' : '?'}
          </button>
        ) : null}
      </div>
      <div className={cx(s.val, valueMuted && s.valMuted)}>{value}</div>
      {note ? (
        <div className={cx(s.note, noteTone === 'pos' && s.notePos, noteTone === 'neg' && s.noteNeg)}>{note}</div>
      ) : null}
      {tag ? (
        <div>
          <span
            className={cx(
              s.tag,
              tag.tone === 'pos' && s.tagPos,
              tag.tone === 'neg' && s.tagNeg,
              tag.tone === 'amb' && s.tagAmb,
              tag.tone === 'muted' && s.tagMuted,
            )}
          >
            {tag.text}
          </span>
        </div>
      ) : null}
      {info && open ? <div className={s.infoPanel}>{info}</div> : null}
    </div>
  );
}

// A detail panel opened from a drill-down — same skin as a section card but with
// a lighter heading (no green circle).
export function DetailPanel({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className={s.card}>
      <div className={s.sechead} style={{ marginBottom: sub ? 3 : 12 }}>
        {title}
      </div>
      {sub ? <div className={s.secdesc} style={{ marginLeft: 0 }}>{sub}</div> : null}
      {children}
    </section>
  );
}

export { s as cockpitStyles };
