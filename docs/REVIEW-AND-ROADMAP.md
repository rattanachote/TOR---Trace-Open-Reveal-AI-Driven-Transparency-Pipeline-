# TOR Web App — Review, Gaps and Roadmap

Reviewed: 31 Oct 2026 (2569) · Scope: everything under `Web App/` plus the TOR proposal (`TOR Proposal.pdf`)

This document lists what the web app does today, where it falls short of the TOR proposal, what should be improved, which new features are worth building, and which systems still have to be set up. Each item has a priority and a rough effort so it can be turned into semester-2 tasks.

**Priority:** **P0** = needed to meet the TOR proposal or to run safely outside this laptop · **P1** = clearly improves usefulness or reliability · **P2** = nice to have
**Effort:** **S** ≈ up to 1 day · **M** ≈ up to 1 week · **L** = more than 1 week

---

## 0. Progress update — 31 Oct 2026

Implemented in the web app after this review (details in `README.md`, tests in `tests/`):

| Roadmap item | Section | Status |
|---|---|---|
| Name search fails with a single space (bug) | 4.3 | **Fixed** — shared Thai normaliser for all searches; titles and legal forms stripped |
| Directory listing exposed (bug) | 4.7 | **Fixed** |
| Security headers, hidden server banner | 4.7 | **Done** (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) |
| Login lockout abuse | 4.7 | **Fixed** — throttled per IP+username and per IP |
| Force password change for bootstrap/admin-set passwords | 4.7 | **Done** (server-enforced) |
| Rate limiting on data APIs | 4.7 | **Done** — 300 requests/min per account or IP |
| Access logs | 4.10 | **Done** — `logs/access.log`, no query strings |
| `/api/health` | 4.10 | **Done** |
| Built-in `reviewer` role | 4.6 | **Done** |
| Review notes, bulk confirmation of agency links | 4.6 | **Done** |
| Publication states + public read-only portal | 4.6 | **Done** — draft → submitted → published/rejected → withdrawn; server rebuilds the graph and keeps only identifier or reviewer-confirmed edges |
| Saved investigations | 4.4 | **Done** (part of the publish workflow) |
| Correction requests | 4.6 | **Done** — public form, reviewer queue, audit trail |
| Re-link audit of bidders, winners, companies, agencies, people | 4.1 | **Done** — see `LINKING-AUDIT.md`; existing links verified, gaps listed |
| Second linking pass (`identity.sqlite3`) | 4.1 | **Done** — 406,316 more bidder links, all "unverified"; shared agency names told apart; same-name people queue |
| DBD coverage worklist | 4.1 | **Ready** — `dbd-fetch-worklist.csv`; the first 5,000 companies cover 78% of uncovered contract value |
| Methodology / disclaimer page | 4.8 | **Done** (`#about`) |
| Server-side red-flag indicators over the full dataset | 4.4 | **Done (first set)** — HHI concentration, top-supplier share, specific-method share, price ≥ 99 % of budget, single-bidder rate, repeated co-bidding pairs with shared directors/shareholders |
| Dashboard, agency and company profiles | 4.5 | **Done** (no map yet) |
| Precomputed aggregates | 4.3 | **Done** — `pipeline/build_analytics.py` → `analytics.sqlite3` |
| Graph filters (verified-only, fiscal-year range) | 4.4 | **Done** |
| Path between two entities | 4.4 | **Done within the loaded graph** (not yet across the whole database) |
| "Data as of" dates | 4.1 | **Done** — home, dashboard, public pages, exports |
| Account database backups | 4.11 | **Done** — `ops/backup_accounts.py` (schedule with Task Scheduler) |
| Unit + API integration tests | 4.12 | **Done** — 13 unit, 7 API tests |

Still open (need data collection, new infrastructure, or research work): DBD coverage, e-GP RSS ingestion, MinIO, OCR, LLM extraction, fuzzy entity resolution + identity review UI, full-text index, Leiden communities, database-wide path search, map, PDPA assessment document, email verification/reset, 2FA, HTTPS/deployment, CI, splitting `tor.js` into modules, accessibility and English UI.

---

## 1. Summary

The app already covers the "explore relationships with evidence" part of the proposal well: search, multi-hop relationship graph, evidence back to the exact source row, simple red-flag observations, a review queue, and accounts with roles. The main gaps are upstream and downstream of that:

| # | Top priorities | Why | Priority | Effort |
|---|---|---|---|---|
| 1 | Expand DBD registry coverage | Only **4.5 %** of contract rows (1,119,779 of 24,956,780) link to a registered company, so most of the graph is missing | P0 | L |
| 2 | Publication workflow + public read-only portal | The proposal says data is checked by a reviewer **before** being published to citizens; today there is no "published" state and every page needs a login | P0 | M |
| 3 | Data ingestion beyond static ZIPs (e-GP RSS, scheduled updates, raw-file storage) | Proposal scope: RSS feed, MinIO raw storage, metadata; today data is a one-off import | P0 | L |
| 4 | OCR + LLM extraction for scanned PDFs | Core proposal feature ("AI-Driven"); not started in the app | P0 | L |
| 5 | Server-side anomaly indicators over the full dataset | Current red flags run only on the ≤180 nodes loaded in the browser | P0 | L |
| 6 | Entity-resolution review (merge/split identities), not only edge review | 43.9 % of bid rows (2,660,057) have an unresolved bidder name | P0 | M |
| 7 | Full-text search index | Free-text searches can scan millions of rows and are cut off after 12 s | P1 | M |
| 8 | Aggregate dashboard (spending, top winners, methods, regions) | Proposal promises an "Interactive Dashboard"; today there are only lists and graphs | P1 | M |
| 9 | Deployment hardening (HTTPS, reverse proxy, backups, logging, monitoring) | Server is a loopback-only Python `http.server` with access logs disabled | P0 before any public deployment | M |
| 10 | Automated tests and evaluation (ER precision/recall, OCR accuracy, SUS) | Needed for the final report; today tests are ad-hoc scripts | P0 | M |

---

## 2. Current state (what exists)

### 2.1 Features

| Area | What works today |
|---|---|
| Search & browse | Search projects, companies, people, agencies; filter by year; browse lists with paging; data-quality list (71 quarantined rows) |
| Relationship graph | Start from a project, company, person, or agency; depth 1–3; branch limit 6–32; network layout and fiscal-year timeline layout; expand any node; re-center; hover highlight; type filters |
| Evidence | Every node/edge shows its source; download the exact CSV row from the original ZIP; preview the row with line number and CRC32; open DBD `profile.pdf`, `raw.json`, `company.json`, `manifest.json` |
| Observations | 4 heuristics on the loaded graph: shared related party between bidders on one project, one person linked to several firms winning from the same agency, repeat awards from one agency, one person in many firms |
| Review | Queue of name-matched edges; reviewers mark correct/incorrect; stored on the server with reviewer name and time |
| Export | Figure export (PNG/SVG, Litmaps-style), JSON export with evidence and review status |
| Accounts | Login, register, change password; roles `user` and `admin`; custom roles with 5 permissions; user management; audit log |
| Offline mode | Opening `frontend/index.html` without the server shows 5 bundled sample projects |

### 2.2 Data coverage (from `output/linked-data/summary.json`)

| Measure | Value | Note |
|---|---|---|
| Contract rows (2565–2569) | 24,956,780 | e-GP via Data.go.th |
| Bid rows | 6,063,203 | **99.9 % are from 2569** (only 3,326 rows for 2566–2568) — competition analysis is effectively 2569-only |
| Registered companies (DBD snapshot) | 89,539 | Single snapshot, Sept 2026; no history |
| Companies that appear in contracts | 11,807 | |
| Contract rows linked to DBD | 1,119,779 (**4.5 %**) | 23,837,001 rows have no registry record |
| Bid rows linked by "same project winner name" | 3,379,313 (55.7 %) | Treated as verified |
| Bid rows linked by unique registry name (unverified) | 23,832 (0.4 %) | Needs review |
| Bid rows with unresolved names | 2,660,057 (43.9 %) | Cannot be linked yet |
| Registry roles (directors/shareholders) | 187,393 | Person IDs hashed |
| Rejected source rows | 71 | Column-count mismatch |

### 2.3 Architecture

- `frontend/` — plain HTML/CSS/JS (1 file of ~1,340 lines for the app logic), SVG graph, no build step.
- `backend/` — Python stdlib `ThreadingHTTPServer`; `api/` routes with permission decorators; `services/` for SQLite, graph building, evidence, accounts.
- Data: 52 GB read-only SQLite (`output/linked-data/procurement.sqlite3`); accounts/reviews/audit in PostgreSQL (Docker).
- `pipeline/` — one-off import and linking scripts.

---

## 3. Gap analysis against the TOR proposal

| Proposal item (chapter 1.3 / 3) | Status | What is missing |
|---|---|---|
| Pull procurement data from e-GP via **RSS feed** | Not started | RSS client, scheduler, incremental import, de-duplication against existing rows |
| Store original files with metadata in **MinIO** | Not started | Object storage; currently source ZIPs sit on the local disk |
| **OCR** for scanned PDFs (announcements, TOR documents, contracts) | Not started | Document download, OCR pipeline (e.g. PP-OCR / Typhoon-OCR), text storage, accuracy measurement |
| **AI/LLM extraction** to structured data | Not started | Extraction prompts/schema, validation, confidence scores, human check of extracted fields |
| Link company, shareholder, director data from **DBD** | Partial | Only 89,539 companies in one snapshot; 4.5 % contract coverage; no history of role changes |
| **Entity resolution** across sources | Partial | Exact/rule-based only; no fuzzy matching, no merge/split UI, no measured accuracy |
| **Social graph** of agencies, projects, companies, people | Done (bounded) | No graph-wide analytics (communities, paths, centrality) |
| **Anomaly detection** / alerts for risky bidding patterns | Partial | Browser-side heuristics on a small subgraph only; no indicators over the full dataset; no alerts |
| **Interactive dashboard** | Partial | Graph + lists exist; no aggregate charts/statistics |
| **Human review before publishing** | Partial | Edge review exists; no publish state, no public view, no review of extracted fields or merged identities |
| Status tracking, history, **backup**, **security** | Partial | Audit log exists; no backups, no monitoring, no HTTPS, access logs disabled |
| Deploy website (task 20) | Not started | Runs only on `127.0.0.1` on one Windows laptop |
| Usability evaluation (**SUS**) | Not started | Test plan, participants, questionnaire |
| Leiden community detection / link prediction (chapter 2) | Not started | Graph analytics job and UI to show results |

---

## 4. Findings and improvements by area

### 4.1 Data coverage and quality

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Collect DBD data for all companies that appear in contracts | Today 11,807 contract companies are registered locally; target the 13-digit IDs found in the 24.9M contract rows first, ordered by contract value | P0 | L |
| Keep DBD history | Store every snapshot and show when a person joined/left a company; the app already warns that roles are "as of collection date" | P1 | M |
| Bid data for 2566–2568 | Only 3,326 bid rows before 2569; co-bidding analysis is limited to one year until more is collected | P1 | M |
| Official agency codes | Agencies are grouped by exact name only (`temporary_name_group`); map to department/agency codes so renamed or misspelled agencies merge | P1 | M |
| Masked IDs | Rows like `310090122xxxx` (individual contractors) cannot be linked; show them as a distinct "individual (masked)" type instead of "unresolved" | P2 | S |
| Data freshness indicator | Show "data as of" per source on every page and in exports | P1 | S |
| Re-import safety | `pipeline/` checkpoints assume unchanged files with the same name (README already warns); add file hashes to `sources` and re-import when they change | P1 | S |

### 4.2 Entity resolution

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Thai name normalisation | Strip titles (นาย/นาง/นางสาว/บริษัท/จำกัด/ห้างหุ้นส่วน…), collapse spaces, normalise Thai digits; use the same function in import and search | P0 | S |
| Fuzzy candidate matching | Score candidates (edit distance, token overlap, same agency/province, same amount) for the 2.66M unresolved bid names; never auto-merge low scores | P0 | M |
| Identity review UI | Reviewer sees candidate pairs side by side with evidence and decides "same / different / unsure"; decisions feed back into links | P0 | M |
| Gold set and metrics | Hand-label a few hundred pairs; report precision/recall per method for the final report | P0 | M |
| Person identity across companies | Hashed IDs already link people; mentions without IDs stay separate — keep this rule and explain it in the UI | — | — |

### 4.3 Search and performance

| Item | Detail | Priority | Effort |
|---|---|---|---|
| **Bug:** name search fails with a single space | DBD names contain double spaces (`นาย ยงยุทธ  ปวิตรปก`); searching `ยงยุทธ ปวิตรปก` returns 0 results, `ยงยุทธ  ปวิตรปก` returns 5. Normalise spaces on both sides | P0 | S |
| Full-text index | Add SQLite FTS5 (or move search to PostgreSQL `pg_trgm` / OpenSearch) for project titles, agencies, company and person names; removes the 12-second timeouts | P1 | M |
| Precomputed aggregates | Tables per agency/company/year (count, total value, winners) so dashboards and graph summaries do not scan raw rows | P1 | M |
| Slow person graphs | A depth-2 graph from a person in 5 companies took ~8 s (company with 47,000+ contracts); add per-company summary nodes ("+47,387 more projects") and cache results | P1 | M |
| Duplicate projects across pages | Project lists page by source row, so projects with several contracts can repeat on the next page; page by project instead | P2 | S |
| Response caching | Cache graph responses by (kind, key, depth, limit) with ETag; data is read-only between imports | P2 | S |
| Search state in the URL | Only graphs are kept in the address bar; also keep search/browse state so links can be shared | P2 | S |

### 4.4 Graph and analysis features

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Server-side red-flag indicators | Compute over the whole dataset, not only the loaded graph. Suggested set (Open Contracting / OECD): single-bidder rate, winner concentration per agency (HHI), repeated co-bidding pairs, bid rotation, winning bid close to budget, splitting below thresholds, companies registered shortly before winning, shared directors/addresses among competitors, unusually high share of `เฉพาะเจาะจง` awards | P0 | L |
| Risk page per entity | For each company/agency show indicators with values, peer comparison, and the evidence rows behind each number | P0 | M |
| "How are A and B connected?" | Shortest/top-k paths between two entities with evidence on every hop | P1 | M |
| Community detection (Leiden) | Batch job over company–person–project graph; show the cluster a company belongs to | P1 | M |
| Link prediction (chapter 2) | Only after the above; present as "possible relationship to check", never as fact | P2 | L |
| Graph filters | Filter by year range, amount, procurement method, confidence level | P1 | S |
| Saved investigations | Save a graph (start point, expanded nodes, notes), reopen later, share inside the team | P1 | M |
| Notes and comments | Attach notes to nodes/edges, visible to the team, included in exports | P2 | M |
| Report export | One-click PDF/DOCX report: figure, key facts, observations, evidence table, caveats | P1 | M |
| Large graphs | SVG is fine up to a few hundred nodes; switch to canvas/WebGL (e.g. Sigma.js) if expansions go beyond ~500 | P2 | M |

### 4.5 Dashboard

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Overview page | Spending by year, by agency, by procurement method; top winners; share of contracts linked to DBD | P1 | M |
| Agency profile | Spending trend, top suppliers, concentration index, methods used, flagged projects | P1 | M |
| Company profile | Contracts won by year, agencies, competitors met in bids, directors over time | P1 | M |
| Map by province | Contracts carry province/district columns; a choropleth helps public users | P2 | M |

### 4.6 Review and publishing workflow

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Publication states | `draft → reviewed → published` (and `rejected`) for edges, identities, extracted fields and observations; only `published` items appear publicly | P0 | M |
| Public read-only portal | No login; shows only published data, with disclaimer and evidence links; the logged-in app stays as the internal workspace | P0 | M |
| Reviewer role | Add a built-in `reviewer` role (`data.view`, `review.confirm`) so confirmation does not require full admin rights | P1 | S |
| Two-person rule (optional) | Require a second reviewer before publishing high-risk items (e.g. red flags naming a person) | P2 | M |
| Review notes | The API already accepts `note`; add a text box and show notes in the queue | P1 | S |
| Queue noise | Agency→project edges are all "medium" (name-grouped agencies), so they fill the queue; allow bulk confirmation per agency, or lower their priority | P1 | S |
| Reviews tied to data version | Review keys are built from source/target/sequence; after a re-import, keys may no longer match. Store the source file hash and re-flag reviews whose evidence changed | P1 | M |
| Correction requests | A form for companies/citizens to report wrong data ("แจ้งแก้ไขข้อมูล"), tracked in the review queue | P1 | M |

### 4.7 Accounts and security

| Item | Detail | Priority | Effort |
|---|---|---|---|
| **Directory listing exposed** | `GET /assets/` returns "Directory listing for /assets/" (stdlib default); disable listings | P0 | S |
| Security headers | Add `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`; hide the `Server: SimpleHTTP/Python` header | P0 | S |
| HTTPS | Needed before any deployment; then mark the session cookie `Secure` | P0 | S (with proxy) |
| Force password change for the first admin | The bootstrap password lives in `.env`; require a change on first login | P1 | S |
| Lockout abuse | Login throttling is per username, so anyone can lock the `admin` account for 10 minutes by sending 8 wrong passwords; throttle per IP + username and use increasing delays | P1 | S |
| Registration controls | Email verification, CAPTCHA or invite-only option, admin switch to close registration | P1 | M |
| Password reset by email | Today only an admin can reset a password | P1 | M |
| Two-factor authentication for admins | TOTP | P2 | M |
| Session management | List and revoke own sessions; admin can sign out a user everywhere (partly exists: deactivating a user deletes sessions) | P2 | S |
| Rate limiting on data APIs | Prevent bulk scraping of personal data through `/api/people` and graphs | P1 | S |
| Secrets | `.env` holds DB and admin passwords in plain text; fine locally, use Docker secrets or a vault in deployment | P1 | S |

### 4.8 Privacy, legal and ethics

| Item | Detail | Priority | Effort |
|---|---|---|---|
| PDPA (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล 2562) assessment | Directors and shareholders are personal data. Document purpose and legal basis, data minimisation (what the public portal shows), retention period, and how a person can request access/correction | P0 | M |
| Public-facing disclaimer and methodology page | Explain sources, matching rules, confidence levels and that observations are not accusations; link it from every page and export | P0 | S |
| Access logging for personal data | Record who viewed or exported person-level data (currently the audit log covers accounts and reviews only) | P1 | S |
| Naming policy for red flags | Decide whether published observations may name individuals, or only companies and agencies | P0 | S |

### 4.9 Frontend and UX

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Split `tor.js` into modules | ~1,340 lines in one file; split into graph engine, panels, search, admin, API client (ES modules, still no build step) | P1 | M |
| Accessibility | Keyboard navigation of graph nodes, focus order in panels, ARIA for tabs/dialogs, colour contrast check of type colours | P1 | M |
| Language toggle (Thai/English) | Useful for advisors, journalists and the final presentation | P2 | M |
| Mobile graph interaction | Pinch zoom and tap targets on small screens; the layout stacks correctly but the graph is hard to use by touch | P2 | M |
| Onboarding / help | Short guided tour: start point → expand → evidence → review | P2 | S |
| Empty and error states | Clear messages when DBD files are missing, when searches time out, when the account DB is down | P1 | S |
| Fonts in exported PNG | PNG export uses whatever Thai font the system has; embed the web font in the SVG before rasterising | P2 | S |

### 4.10 Backend and API

| Item | Detail | Priority | Effort |
|---|---|---|---|
| API documentation | OpenAPI/Swagger spec generated from the route registry | P1 | S |
| Versioning | Prefix `/api/v1/` before external users depend on it | P1 | S |
| Consistent pagination | Today `after`, `cursor`, and a special bid "tail" offset are used by different endpoints; use one cursor format | P2 | S |
| Production server | `http.server` is fine for local use; for deployment move to a WSGI/ASGI server (e.g. FastAPI + Uvicorn) behind Nginx/Caddy, or at least run behind a proxy with timeouts | P0 (deploy) | M |
| Access logs | `log_message` is disabled; log method, path, status, time, user id (not query strings with personal data) | P0 | S |
| Health endpoint | `/api/health` checking SQLite and PostgreSQL, for monitoring and Docker health checks | P1 | S |
| Background jobs | Long tasks (imports, OCR, LLM, indicators, exports) need a job queue instead of request threads | P0 (with OCR/LLM) | M |

### 4.11 Operations and deployment

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Containerise the app | Dockerfile for the backend; compose file with app + PostgreSQL + proxy; the 52 GB SQLite mounted read-only (test performance on Docker Desktop bind mounts first) | P0 | M |
| Cross-platform start | `Start Web App.cmd` is Windows-only; add a Makefile or shell script | P2 | S |
| Backups | Nightly `pg_dump` of accounts/reviews/audit; checksum list of source ZIPs and the SQLite file | P0 | S |
| Monitoring | Uptime check, disk space (SQLite + raw files), error rate | P1 | S |
| CI | Run linters and tests on every push (GitHub Actions); the project folder is not a Git repository yet | P1 | S |
| Hosting plan | Decide where the deployed version runs (university server / cloud VM); the dataset needs ~60 GB disk plus raw files | P0 | S |

### 4.12 Testing and evaluation

| Item | Detail | Priority | Effort |
|---|---|---|---|
| Unit tests | Name normalisation, permission checks, review guards, evidence path checks, graph builder limits | P0 | M |
| API integration tests | Login/register, permission matrix (user vs admin vs custom role), evidence downloads, timeouts | P0 | S |
| End-to-end tests | Move the Playwright scripts used during development into `tests/e2e/` and run them in CI | P1 | S |
| Entity-resolution accuracy | Precision/recall on a labelled set (see 4.2) | P0 | M |
| OCR / extraction accuracy | Character/word error rate on Thai scanned documents; field-level accuracy for LLM extraction | P0 | M |
| Usability (SUS) | Task-based sessions with citizens, journalists/NGO staff and reviewers; SUS questionnaire as planned in the proposal | P0 | M |
| Performance baseline | Record response times for search, graph depth 1–3, evidence download; re-check after each change | P1 | S |

---

## 5. Systems still required

| System | Purpose | Suggested option | Needed for |
|---|---|---|---|
| Object storage | Keep original files (ZIP, PDF, HTML, DBD JSON/PDF) with metadata and hashes | MinIO (already in the proposal) | Ingestion, evidence, audit |
| Ingestion scheduler | Poll e-GP RSS and Data.go.th, download new files, track runs | Python worker + cron/APScheduler, or Prefect | Fresh data |
| Job queue / workers | Run OCR, LLM extraction, imports, indicator computation outside web requests | Redis + RQ/Celery, or PostgreSQL-based queue | OCR, LLM, analytics |
| OCR service | Text from scanned Thai PDFs | PaddleOCR / Typhoon-OCR / Tesseract (tha) — compare on a sample | Document processing |
| LLM extraction service | Turn OCR text into structured fields with confidence | Hosted LLM API or local model; strict JSON schema + validation | Document processing |
| Analytics database | Aggregates, indicators, dashboards on 25M+ rows | DuckDB or PostgreSQL (with partitioning) next to the SQLite file | Dashboard, red flags |
| Search index | Fast Thai full-text search | SQLite FTS5 (simplest), PostgreSQL `pg_trgm`, or OpenSearch with Thai analyzer | Search |
| Graph analytics | Communities, paths, centrality | NetworkX/igraph + `leidenalg` batch jobs; Neo4j only if interactive graph queries become the bottleneck | Analysis |
| Email service | Verification, password reset, review notifications | SMTP relay (university mail / SendGrid) | Accounts |
| Reverse proxy + TLS | HTTPS, compression, rate limiting, security headers | Caddy or Nginx | Deployment |
| Backup | Accounts DB, reviews, raw files index | `pg_dump` cron + off-machine copy | Operations |
| Logging & monitoring | Access/error logs, uptime, disk | Loki/Grafana or a simple log file + uptime checker | Operations |
| CI/CD | Tests and deployment | GitHub Actions | Quality |
| Version control | History of code and docs | Git repository (not initialised yet) | Everything |

---

## 6. Suggested roadmap for semester 2 (Jan–May 2570)

Aligned with the Gantt chart in the proposal (tasks 12–14 and website work).

| Phase | Weeks | Goals |
|---|---|---|
| **0. Foundations** | Jan wk 1–2 | Git repo + CI; quick security fixes (directory listing, headers, logging); name normalisation + search bug; backups; health endpoint |
| **1. Data** | Jan wk 3 – Feb wk 2 | DBD collection for contract companies; MinIO raw storage; RSS/scheduled ingestion; full-text index; aggregates tables |
| **2. AI pipeline** | Feb wk 1 – Mar wk 2 | OCR on a sample of scanned documents; LLM extraction schema; job queue; accuracy measurement |
| **3. Entity resolution & analytics** | Feb wk 3 – Mar wk 4 | Fuzzy matching + identity review UI; gold set; server-side indicators; Leiden communities; path finder |
| **4. Publishing** | Mar wk 3 – Apr wk 2 | Publication states; public read-only portal; methodology/disclaimer; PDPA document; correction requests; dashboard pages |
| **5. Deploy & evaluate** | Apr wk 2 – May wk 2 | Containerised deployment behind HTTPS; SUS sessions; performance baseline; final report figures |

---

## 7. Quick wins (≤ 1 day each)

1. Disable directory listings and add security headers in `backend/api/handler.py`.
2. Normalise whitespace (and Thai titles) in people/company search — fixes the double-space bug.
3. Turn access logging back on (without query strings that contain names).
4. Throttle logins per IP + username instead of username only.
5. Force password change for the bootstrap admin.
6. Add a built-in `reviewer` role.
7. Add a note box to review decisions (API already supports `note`).
8. Bulk-confirm agency→project edges per agency to shrink the review queue.
9. Show "data as of" dates on the home page and in exports.
10. Add `/api/health`.
11. Nightly `pg_dump` script for the account database.
