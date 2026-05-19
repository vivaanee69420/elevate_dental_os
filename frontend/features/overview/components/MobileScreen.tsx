'use client';
// Mobile App — pixel-faithful port of preview/elevate-dental-os-v2.html
// (PAGES.mobile). Static marketing page: "what you can do on mobile" list,
// a brand-gradient download card, and an offline-mode note. Pure content,
// no state, no backend. The prototype decorated each list item and download
// button with an emoji; project rule 7 forbids emojis, so those are dropped
// (a small leading brand bullet replaces the list glyph). No data layer
// needed for this screen.

const BRAND = '#0E7C7B';

/** One capability listed in the "what you can do on mobile" card. */
interface Capability {
  title: string;
  desc: string;
}

const CAPABILITIES: Capability[] = [
  {
    title: "View today's numbers across all practices",
    desc: 'Live revenue, leads, bookings, cash position',
  },
  {
    title: 'Plan4Growth AI anything',
    desc: 'Voice or text · same AI brain as desktop',
  },
  {
    title: 'Approve pay runs & lab invoices',
    desc: 'Touch-ID confirmation · no need to be at desk',
  },
  {
    title: 'Respond to reviews on the go',
    desc: 'AI-drafted replies you edit and send',
  },
  {
    title: 'Launch a marketing campaign',
    desc: 'Pick template · approve copy · live in 5 min',
  },
  {
    title: 'Receive push alerts',
    desc: 'Hot lead · cash low · big debtor · acted on instantly',
  },
];

/** Mobile App page. */
export default function MobileScreen() {
  return (
    <div className="container mx-auto" style={{ maxWidth: 1500 }}>
      <div className="mb-6">
        <h1 className="display text-3xl font-bold">Mobile Dashboard</h1>
        <p className="text-sm text-ink-muted mt-1">
          Run your group from your phone · everything in your pocket
        </p>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}
      >
        {/* Capabilities */}
        <div className="card-padded">
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            What you can do on mobile
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, fontSize: 13, margin: 0 }}>
            {CAPABILITIES.map((c, i) => (
              <li
                key={c.title}
                style={{
                  padding: '10px 0',
                  borderBottom:
                    i < CAPABILITIES.length - 1
                      ? '1px solid var(--border)'
                      : 'none',
                }}
              >
                <strong>{c.title}</strong>
                <div
                  className="text-ink-muted"
                  style={{ fontSize: 11, marginTop: 2 }}
                >
                  {c.desc}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Download card */}
        <div
          className="card-padded text-white"
          style={{
            background: `linear-gradient(135deg, ${BRAND} 0%, #085857 100%)`,
            border: 'none',
          }}
        >
          <h2
            className="display font-semibold"
            style={{ fontSize: 17, marginBottom: 12 }}
          >
            Download the app
          </h2>
          <div style={{ marginBottom: 16, fontSize: 13, opacity: 0.9 }}>
            Free with your Elevate subscription. Available for iOS and Android.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="font-semibold"
              style={{
                background: 'white',
                color: BRAND,
                border: 'none',
                padding: 12,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Download for iPhone
            </button>
            <button
              type="button"
              className="font-semibold"
              style={{
                background: 'white',
                color: BRAND,
                border: 'none',
                padding: 12,
                borderRadius: 8,
                cursor: 'pointer',
              }}
            >
              Download for Android
            </button>
          </div>
          <div
            style={{
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.2)',
              fontSize: 12,
              opacity: 0.8,
            }}
          >
            QR code for quick download:
            <div
              style={{
                background: 'white',
                padding: 8,
                marginTop: 8,
                borderRadius: 6,
                color: BRAND,
                textAlign: 'center',
                fontFamily: 'monospace',
                fontSize: 10,
              }}
            >
              [ QR ]
              <br />
              code shown
              <br />
              in production
            </div>
          </div>
        </div>
      </div>

      {/* Offline mode */}
      <div className="card-padded">
        <h2
          className="display font-semibold"
          style={{ fontSize: 17, marginBottom: 12 }}
        >
          Offline mode
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          When your internet drops, Elevate keeps working. Patient payments,
          schedule changes, and clock-ins continue to be captured locally and
          sync automatically the moment you&apos;re back online.{' '}
          <strong>Never lose a transaction.</strong>
        </p>
      </div>
    </div>
  );
}
