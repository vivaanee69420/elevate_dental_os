'use client';
// Training — 1-to-1 Coaching. Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-onetoone'].
//
// Render path:
//   status.active === false -> locked upsell card
//   status.active === true  -> allowance banner (allowance/used/remaining)
//                              + (1-to-1 bookings ? "My upcoming" : -)
//                              + available slots grouped by date
//
// allowance = 120 min/month; used = sum of this-month 1-to-1 durations
// (none in the empty BOOKINGS snapshot, so used = 0, remaining = 120).
// Emoji glyphs replaced with text labels (project rule 7).
import {
  ONE_TO_ONE_SLOTS,
  MENTORSHIP_STATUS,
  BOOKINGS,
  type OneToOneSlot,
} from '../data';

const PURPLE = '#9333EA';
const PURPLE_DARK = '#6D28D9';
const AMBER = '#FFB547';

/** 1-to-1 Coaching screen. */
export default function OneToOneCoachingScreen() {
  const status = MENTORSHIP_STATUS;
  const bookings = BOOKINGS;
  const oneToOnes = bookings.filter((b) => b.type === '1to1');

  // Gated state for non-members (prototype upsell card).
  if (!status.active) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <div className="mb-6">
          <h1 className="display font-bold" style={{ fontSize: 28 }}>
            1-to-1 Coaching
          </h1>
        </div>
        <div
          className="card-padded"
          style={{ textAlign: 'center', padding: '50px 20px' }}
        >
          <h2
            className="display font-bold"
            style={{ fontSize: 22, margin: '12px 0' }}
          >
            Mentorship required
          </h2>
          <p
            className="text-ink-muted"
            style={{ fontSize: 14, marginBottom: 20 }}
          >
            1-to-1 sessions are included with Diploma Membership (2
            hours/month).
          </p>
          <button
            style={{
              padding: '12px 24px',
              background: PURPLE,
              color: 'white',
              border: 'none',
              borderRadius: 8,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Upgrade — £497/month
          </button>
        </div>
      </div>
    );
  }

  // Allowance arithmetic (prototype constants).
  const usedThisMonth = oneToOnes
    .filter(
      (b) =>
        new Date(b.when).getMonth() === new Date().getMonth(),
    )
    .reduce((s, b) => s + b.duration, 0);
  const allowance = 120; // 2 hours/month
  const remaining = Math.max(0, allowance - usedThisMonth);

  // Group available slots by date (insertion order preserved by sort).
  const slotsByDate: Record<string, OneToOneSlot[]> = {};
  ONE_TO_ONE_SLOTS.forEach((s) => {
    if (!slotsByDate[s.date]) slotsByDate[s.date] = [];
    slotsByDate[s.date].push(s);
  });

  /** Section heading style (display, prototype sizing). */
  const h2: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 700,
    margin: '20px 0 10px',
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="display font-bold" style={{ fontSize: 28 }}>
          1-to-1 Coaching
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Private sessions with Gaurav, Nadia &amp; the team
        </p>
      </div>

      {/* Allowance banner */}
      <div
        className="card-padded"
        style={{
          background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
          color: 'white',
          border: 'none',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 24,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              Your monthly allowance
            </div>
            <div
              className="display font-bold"
              style={{ fontSize: 24, marginTop: 4 }}
            >
              {Math.floor(allowance / 60)}h {allowance % 60}m
            </div>
          </div>
          <div
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.2)',
              borderRight: '1px solid rgba(255,255,255,0.2)',
              padding: '0 24px',
            }}
          >
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              Used this month
            </div>
            <div
              className="display font-bold"
              style={{ fontSize: 24, marginTop: 4 }}
            >
              {Math.floor(usedThisMonth / 60)}h {usedThisMonth % 60}m
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                textTransform: 'uppercase',
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              Remaining
            </div>
            <div
              className="display font-bold"
              style={{
                fontSize: 24,
                marginTop: 4,
                color: remaining > 0 ? AMBER : 'rgba(255,255,255,0.6)',
              }}
            >
              {Math.floor(remaining / 60)}h {remaining % 60}m
            </div>
          </div>
        </div>
      </div>

      {/* My upcoming 1-to-1 calls */}
      {oneToOnes.length > 0 && (
        <>
          <h2 className="display" style={h2}>
            My upcoming 1-to-1 calls
          </h2>
          {oneToOnes.map((b) => (
            <div
              key={b.id}
              className="card-padded"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginBottom: 8,
                borderLeft: `4px solid ${PURPLE}`,
              }}
            >
              <div style={{ textAlign: 'center', minWidth: 60 }}>
                <div
                  className="display font-bold"
                  style={{ fontSize: 24, color: PURPLE }}
                >
                  {new Date(b.when).getDate()}
                </div>
                <div
                  className="text-ink-muted"
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                  }}
                >
                  {new Date(b.when).toLocaleDateString('en-GB', {
                    month: 'short',
                  })}{' '}
                  ·{' '}
                  {new Date(b.when).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div
                  className="display font-bold"
                  style={{ fontSize: 14 }}
                >
                  {b.host}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 12 }}
                >
                  {b.duration} min · 1-to-1
                </div>
              </div>
              <button
                style={{
                  padding: '8px 14px',
                  background: PURPLE,
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Join
              </button>
              <button
                style={{
                  padding: '8px 12px',
                  background: 'white',
                  color: 'var(--danger)',
                  border: '1px solid var(--danger)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          ))}
        </>
      )}

      {/* Available slots — next 7 days */}
      <h2 className="display" style={h2}>
        Available slots — next 7 days
      </h2>
      {Object.keys(slotsByDate)
        .sort()
        .map((date) => {
          const d = new Date(date);
          return (
            <div
              key={date}
              className="card"
              style={{ marginBottom: 12, overflow: 'hidden' }}
            >
              <div
                className="display font-bold"
                style={{
                  padding: '10px 16px',
                  background: 'var(--bg)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 14,
                }}
              >
                {d.toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 8,
                  padding: 12,
                }}
              >
                {slotsByDate[date].map((s) => {
                  const isBooked = bookings.some(
                    (b) => b.id === `1to1-${s.id}`,
                  );
                  const tooLong = s.duration > remaining;
                  return (
                    <div
                      key={s.id}
                      style={{
                        padding: 12,
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: isBooked ? 'var(--bg)' : undefined,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <div
                          className="display font-bold"
                          style={{ fontSize: 18, color: PURPLE }}
                        >
                          {s.time}
                        </div>
                        <span
                          className="text-ink-muted"
                          style={{ fontSize: 11, fontWeight: 600 }}
                        >
                          {s.duration} min
                        </span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {s.with}
                      </div>
                      <div
                        className="text-ink-muted"
                        style={{ fontSize: 11, marginBottom: 8 }}
                      >
                        {s.topic}
                      </div>
                      {isBooked ? (
                        <div
                          className="text-ink-muted"
                          style={{
                            padding: 6,
                            textAlign: 'center',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          Booked
                        </div>
                      ) : tooLong ? (
                        <div
                          className="text-ink-muted"
                          style={{
                            padding: 6,
                            textAlign: 'center',
                            fontSize: 10,
                          }}
                        >
                          Not enough monthly allowance
                        </div>
                      ) : (
                        <button
                          style={{
                            width: '100%',
                            padding: 7,
                            background: PURPLE,
                            color: 'white',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Book this slot
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

      {/* Booking tips */}
      <div
        className="card-padded"
        style={{ marginTop: 16, background: 'var(--brand-50)' }}
      >
        <strong style={{ fontSize: 14 }}>Booking tips</strong>
        <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
          1-to-1 slots are first-come. Cancellations within 24 hours forfeit
          the allowance. Need more than 2 hours/month? Add hours at £150/hr
          in Settings → Billing.
        </p>
      </div>
    </div>
  );
}
