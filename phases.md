# Phases — DentaCFO Feature-Gap Build

Phase tracker for porting the demo's missing modules (`GM-Group-Intelligence-OS_2.html`)
into the real app. **One phase per context**, committed individually; clear context
between phases. Detailed context + integration table: `BUILD-DENTACFO-MODULES.md`.

Branch: `feat/dentacfo-modules`. Resume after `/clear`: read this file + `BUILD-DENTACFO-MODULES.md`, then say the next phase number.

| Phase | Module | New integration | Status | Commit |
|---|---|---|---|---|
| 1 | Revenue Leakage | none | ✅ done | committed (see `git log` HEAD of branch) |
| 2 | Board Report Generator | none (Claude + SES email) | ⬜ next | — |
| 3 | M&A Acquisition Modeller (buy-side) | none | ⬜ | — |
| 4 | Exit Plan (full 4% personal-wealth model) | none | ⬜ | — |
| 5 | Data Quality Engine | none | ⬜ | — |
| 6 | Attrition & Retention | none (may need Dentally re-sync) | ⬜ | — |
| 7 | Open Banking | **GoCardless Bank Account Data** (decided) | ⬜ | — |

## Per-phase done-criteria
Backend: formula (+ test + FORMULAS.md if new calc) → repo → service → controller → route (gated) → API.md. Frontend: api → hook → screen → page → nav + route-perm. Verify: backend `npm test` green + frontend `tsc --noEmit` clean. Then commit + tick this table.

## Decisions
- **Phase 7 provider = GoCardless Bank Account Data** (free AIS tier, balances + transactions, read-only cash position). Mirrors existing Xero/GHL OAuth + encrypted-secret pattern.

## Log
- 2026-06-09 — Phase 1 (Revenue Leakage) built + verified (606 backend tests, tsc clean), committing now.
