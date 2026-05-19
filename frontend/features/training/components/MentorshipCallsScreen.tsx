'use client';
// Training — Mentorship Calls (group calls). Pixel-faithful port of
// preview/elevate-dental-os-v2.html PAGES['training-mentorship'].
//
// Render path:
//   status.active === false -> locked upsell card
//   status.active === true  -> status banner
//                              + (bookings ? "My upcoming calls" : -)
//                              + upcoming group-call list (book/full/booked)
//
// Bookings are the static (empty) BOOKINGS snapshot — matches the
// prototype's fresh state. Emoji glyphs replaced with text labels
// (project rule 7).
import {
  MENTORSHIP_CALLS,
  MENTORSHIP_STATUS,
  BOOKINGS,
  gbMonthShort,
  gbWeekdayShort,
  gbTime,
} from '../data';

const PURPLE = '#9333EA';
const PURPLE_DARK = '#6D28D9';

/** Mentorship Calls screen. */
export default function MentorshipCallsScreen() {
  const status = MENTORSHIP_STATUS;
  const bookings = BOOKINGS;

  // Gated state for non-members (prototype shows an upsell card).
  if (!status.active) {
    return (
      <div className="mx-auto" style={{ maxWidth: 1280 }}>
        <div className="mb-6">
          <h1 className="display font-bold" style={{ fontSize: 28 }}>
            Mentorship Calls
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
            Group calls and 1-to-1 coaching are part of the Plan4Growth
            Diploma Membership.
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
          Mentorship Calls
        </h1>
        <p className="text-ink-muted" style={{ fontSize: 13 }}>
          Group calls with Gaurav, Nadia &amp; the Plan4Growth team · book
          and attend live
        </p>
      </div>

      {/* Status banner */}
      <div
        className="card-padded"
        style={{
          background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE_DARK})`,
          color: 'white',
          border: 'none',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div className="display font-bold" style={{ fontSize: 16 }}>
            {status.tier} · Active
          </div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            Unlimited group calls · {bookings.length} booked so far
          </div>
        </div>
      </div>

      {/* My upcoming calls */}
      {bookings.length > 0 && (
        <>
          <h2 className="display" style={h2}>
            My upcoming calls
          </h2>
          <div style={{ marginBottom: 24 }}>
            {bookings.map((b) => (
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
                    className="text-ink-muted"
                    style={{
                      fontSize: 11,
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    }}
                  >
                    {gbMonthShort(b.when)}
                  </div>
                  <div
                    className="display font-bold"
                    style={{ fontSize: 26, color: PURPLE }}
                  >
                    {new Date(b.when).getDate()}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 11 }}
                  >
                    {gbTime(b.when)}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    className="display font-bold"
                    style={{ fontSize: 15 }}
                  >
                    {b.title}
                  </div>
                  <div
                    className="text-ink-muted"
                    style={{ fontSize: 12, marginTop: 2 }}
                  >
                    {b.host} · {b.duration} min ·{' '}
                    {b.type === 'group' ? 'Group call' : '1-to-1'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
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
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Upcoming group calls */}
      <h2 className="display" style={h2}>
        Upcoming group calls
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: 10,
        }}
      >
        {MENTORSHIP_CALLS.map((c) => {
          const isBooked = bookings.some((b) => b.id === c.id);
          const isFull = typeof c.spots === 'number' && c.spots <= 0;
          return (
            <div
              key={c.id}
              className="card-padded"
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr auto',
                gap: 18,
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  textAlign: 'center',
                  padding: 10,
                  background: '#F3E8FF',
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: PURPLE,
                    textTransform: 'uppercase',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                  }}
                >
                  {gbWeekdayShort(c.when)}
                </div>
                <div
                  className="display font-bold"
                  style={{ fontSize: 24, color: PURPLE }}
                >
                  {new Date(c.when).getDate()}
                </div>
                <div
                  style={{ fontSize: 11, color: PURPLE, fontWeight: 600 }}
                >
                  {gbMonthShort(c.when)}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 11, marginTop: 4 }}
                >
                  {gbTime(c.when)}
                </div>
              </div>
              <div>
                <div
                  className="display font-bold"
                  style={{ fontSize: 16 }}
                >
                  {c.title}
                </div>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 13, margin: '4px 0' }}
                >
                  {c.desc}
                </div>
                <div
                  className="text-ink-muted"
                  style={{
                    display: 'flex',
                    gap: 16,
                    fontSize: 11,
                    marginTop: 6,
                  }}
                >
                  <span>{c.host}</span>
                  <span>{c.duration} min</span>
                  <span>
                    {typeof c.spots === 'number'
                      ? `${c.spots} spots`
                      : 'Open to all members'}
                  </span>
                </div>
              </div>
              <div>
                {isBooked ? (
                  <span
                    className="text-ink-muted"
                    style={{
                      display: 'inline-block',
                      padding: '10px 18px',
                      background: 'var(--bg)',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Booked
                  </span>
                ) : isFull ? (
                  <span
                    className="text-ink-muted"
                    style={{
                      display: 'inline-block',
                      padding: '10px 18px',
                      background: 'var(--bg)',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Full
                  </span>
                ) : (
                  <button
                    style={{
                      padding: '10px 18px',
                      background: PURPLE,
                      color: 'white',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Book seat
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
