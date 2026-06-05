# DESIGN.md — Elevate Dental OS design system

Single source of truth for the visual system. Extracted from the
`GM-Group-Intelligence-OS_3.html` prototype and adopted **app-wide**
(decision: `/plan-design-review` 2026-06-05, see `GM-INTELLIGENCE-OS-PLAN.md` §13).

Migration note: this replaces the prior teal+amber theme (`--brand #0E7C7B`,
`--accent #FFB547`) ported from `preview/elevate-dental-os-v2.html`. Token **names**
are unchanged so existing screens re-skin centrally; only **values** change. The
remaining per-screen layout polish is the deferred sweep (task D5).

## Principles (project rules — non-negotiable)

1. Light/white only — no dark mode.
2. British English in all UI (organisation, colour, optimise, centre).
3. No emojis in UI; use the app icon set (lucide). Decorative glyphs get `aria-hidden`.
4. Money: integer pence; display `(pence/100).toLocaleString('en-GB')`.
5. Exclude "Italy Implant Residency" everywhere.

## Typography

- Display / headings: **Fraunces** (serif), weight 500-600. `h1,h2,h3,.display` + `font-display`.
- Body / UI: **Inter**, weight 400-700. `font-sans`.
- Base size 14px, line-height 1.5. Both already loaded (Google Fonts + `tailwind.config.ts`).

## Colour tokens (the swap)

| Token | Old (teal/amber) | New (green/gold) | Use |
|---|---|---|---|
| `--bg` | #F6F7F9 | **#EEF3EF** | app background (warm green-grey) |
| `--surface` / `--card` | #FFFFFF | #FFFFFF | panels, cards |
| `--ink` | #0F172A | **#15241E** | primary text (green-black) |
| `--ink-muted` | #64748B | **#566B62** | secondary text (≥4.5:1) |
| `--ink-soft` | #94A3B8 | **#5F7268** | tertiary text — darkened from prototype #84958c to pass WCAG 4.5:1 (D4) |
| `--brand` (DEFAULT/500) | #0E7C7B | **#1D6E5F** | primary accent (deep green) |
| `--brand-600` | #0B6968 | **#175C50** | hover/pressed |
| `--brand-700` | #085857 | **#0F5132** | darkest (prototype --accent-3) |
| `--brand-50` | #E6F4F4 | **#E2EFE9** | tint / accent-soft |
| `--accent` | #FFB547 | **#C6A253** | gold secondary accent |
| `--gold` | #B8860B | #C6A253 | alias of accent |
| `--success` | #10B981 | **#2E9E6A** | good (+ bg #E3F4EA) |
| `--warning` | #F59E0B | **#BF8A22** | warn (+ bg #FAF0D6) |
| `--danger` | #EF4444 | **#C25F4D** | bad (+ bg #F8E6E1) |
| `--info` | #3B82F6 | **#2B7A8C** | info/blue (+ bg #E1F0F2) |
| `--border` | #E5E7EB | **#DCE4DF** | hairlines (prototype --line) |

Decorative-only soft line: `--line-2` ≈ rgba(26,46,38,.07) → `#EBF0EC`.

## Shape & elevation

- `--radius` 10 → **14px**; `--radius-sm` 6 → **10px**; panels up to 18px.
- `--shadow-sm`: `0 6px 18px rgba(20,60,46,.07)`; `--shadow`: `0 18px 48px rgba(20,60,46,.10)`.

## Status / semantic bg pairs (KPI tags, pills, alerts)

`good #2E9E6A / #E3F4EA` · `warn #BF8A22 / #FAF0D6` · `bad #C25F4D / #F8E6E1` ·
`info #2B7A8C / #E1F0F2`. Channel accents (marketing): gads #3B7DDD, meta #4267B2,
insta #C2548A, seo #2F9E7A, ref #C0883A, recall #3F8F9C.

## Shared primitives (build first — task T4)

`components/ui`: `KpiCard`, `BarRow`, `HeatCell`, `AlertRow`, `PanelHeader`, `DataTable`.
All consume these tokens; never hard-code hex in screens.

## Accessibility

- Body text ≥ 4.5:1 (hence the `--ink-soft` darkening). Decorative glyphs `aria-hidden`.
- Never colour-only: the heat matrix prints the £ value + a non-colour cue (rank/intensity bar) — WCAG 1.4.1 (task D3).
- Touch targets ≥ 44px. KPI strips stack on mobile; dense financial tables may scroll horizontally.
