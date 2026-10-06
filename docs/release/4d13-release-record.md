# Phase 4D.13 — operational readiness release record

**Status: RELEASED (4D.13D, 2026-10-06/07)** — application-only release; no migration, no schema or configuration change.

| Item            | Value                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Release commit  | `1c6a01a` (fast-forward of `main` from `9034a73`)                                                               |
| Deployment      | `dpl_HF9Lzsp7LpS6WWdYwUAXoP5Q4DFr` — READY, serving `value-office-cdx.vercel.app`                               |
| Rollback target | `dpl_9n36j1ALxAucTdEc5pHFiyMW1ENg` (`9034a73`)                                                                  |
| Database        | Production `main` (`br-tiny-star-b7b8d3bh` / `ep-old-mode-b7jl3rd0`); migration 0026, 27 rows; schema unchanged |
| Runtime         | `vo_runtime` only, least privilege PASS; `vo_app` absent                                                        |
| Reports / PDFs  | The three pre-existing issued reports byte-identical; stored PDFs match                                         |
| Health          | `/api/health` ok (database ok)                                                                                  |

## Scope released

1. Information Request working queue (Outstanding items; overdue / due soon / outstanding).
2. "Person — Role" in owner pickers and displays.
3. Setup labels ("Person's name", "Role on this engagement").
4. IR driver names from the authorised version.
5. Working-assumptions help on the driver page.
6. Evidence "Needs classification" flag and filter; Overview operational signals.
7. Guard: a Value Change cannot be authorised while a draft Assurance Review is measured against its from-version.

Functional acceptance was read-only (page loads as the signed-in user, no writes): items 1, 2, 5 and 6 observed on existing
production data; items 3, 4 and 7 accepted on tests and source identity.

## Data note

POST against the 4D.10 release baseline showed factual differences. All were attributed to normal application use of
PROJECT-DREAM ("Project Dream Big") by Rhys Davies between 20:38 and 21:21Z on 2026-10-06 (audit ids 402–452). Every
other project and the three original issued reports are unchanged. The release changed no data. The 4D.10 release
baseline is therefore no longer a whole-database comparator; future releases need a fresh baseline.
