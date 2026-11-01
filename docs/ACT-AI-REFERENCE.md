# ACT Ai as a design reference for TOR

Explored: 31 Oct 2026 (2569) · Sites: [actai.co](https://actai.co/), [procurement.actai.co](https://procurement.actai.co/), [poldata.actai.co](https://poldata.actai.co/), [opendata.actai.co](https://opendata.actai.co/)
Screenshots: [`reference/actai/`](reference/actai/)

This document records what ACT Ai shows, page by page, and maps every piece of information to TOR's own data. Each item is marked with what it would take to show it in TOR. The last sections turn that into a page plan and a backlog.

**Data status in TOR:**
- **Have**: already stored in `procurement.sqlite3` or `analytics.sqlite3` and shown or easy to show.
- **Derive**: the raw fields exist and only need a query or a pipeline step.
- **Missing**: needs a new data source.

**Priority:** **P0** = core to the TOR proposal · **P1** = clearly useful · **P2** = nice to have
**Effort:** **S** ≈ up to 1 day · **M** ≈ up to 1 week · **L** = more than 1 week

---

## 1. What ACT Ai is

ACT Ai is run by the Anti-Corruption Organization of Thailand (องค์กรต่อต้านคอร์รัปชัน (ประเทศไทย)) with HAND, Punch Up, Boonmee Lab and iApp. `actai.co` is a launcher for nine tools:

| Tool | URL | What it does | Relevance to TOR |
|---|---|---|---|
| จับโกงงบจัดซื้อจัดจ้างภาครัฐ | procurement.actai.co | Search projects, agencies, contractors; rule-based risk flags | **Direct reference.** Same e-GP domain |
| Politics Data | poldata.actai.co | Politicians' assets, debts, business links, court cases, party donations | Reference for the person page and the politician-link flags |
| Corruption Watch | LINE @corruptionwatch | Anonymous tip-off chat with case tracking | Reference for the correction and tip flow |
| ฐานข้อมูลเปิดเพื่อการต่อต้านคอร์รัปชัน | opendata.actai.co | CKAN-style dataset catalogue, 37 processed datasets, 12 linkable | Reference for an open-data download page |
| จับโกงงบ อบจ. / โรงเรียนโปร่งใส / CoST / COVID | various | Issue-specific budget tools | Out of scope |

**Data scope stated on the procurement site:**
- years พ.ศ. 2551 to the present
- 44,059,513 projects
- 741,876 agencies
- 253,223 contractors

**TOR today:**
- contracts from fiscal years 2565 to 2569: 24,956,780 contract rows and 6,063,203 bid rows
- DBD registry: 89,539 companies and 187,393 people

---

## 2. Design patterns worth borrowing

ACT Ai's black-and-red look is its brand and should not be copied; TOR keeps its Litmaps-style light theme. The structure and the explanation habits are what is worth borrowing.

| # | Pattern | Where ACT Ai uses it | Apply in TOR |
|---|---|---|---|
| D1 | **Global search in the header on every page**, with placeholder text listing what can be searched | All pages | Add the search field to the top of internal pages (the rail search is already there; also put it on full-page profiles) |
| D2 | **Results grouped by entity type** with tabs `ทั้งหมด / โครงการฯ / หน่วยงานรัฐ / ผู้รับจ้าง`, the top 3 of each on the "all" tab, and `ดูทั้งหมด (N)` | `/result` | Same, plus a `บุคคล` tab |
| D3 | **Summary strip above a result list**: count, total budget, % flagged, number of agencies and contractors involved | Results "โครงการฯ" tab | Same |
| D4 | **Filter panel**: fiscal-year range, project location, project status, procurement method, procurement type, contractor type, budget range, contract-value range, "flagged projects only" checkbox, `ล้างตัวกรอง` and `ตกลง` buttons | Results | Same filters on search results and on the project lists in profiles |
| D5 | **`ดาวน์โหลดทั้งหมด (CSV)` and `คัดลอกลิงก์` on every table**; sort control with direction toggle | Results, profile tables | Same; the link must reproduce filters and sort |
| D6 | **Profile layout**: title, `อัปเดตข้อมูลเมื่อ dd/mm/yyyy`, a red risk box on the right (`พบความเสี่ยงทุจริต N ประเด็น · ดูรายละเอียด` expands to the rule names), share buttons. Below that, a **left section nav** with sub-anchors and a "next section" button at the bottom of each section | Project, contractor, agency | Full-page profiles for project, company, agency and person. The graph stays one click away |
| D7 | **Inline explainers**: `ตัวเลขนี้บ่งบอกอะไร`, `กราฟนี้บ่งบอกอะไร`, `มีวิธีอะไรบ้าง`, `ACT Ai ตรวจสอบโครงการเสี่ยงอย่างไร ?` link from every figure to a short definition | Everywhere | Add an `(i)` explainer next to every computed number and chart, linking to the methodology page |
| D8 | **Fiscal-year footnote** next to every year: "ปีงบประมาณ เริ่มนับจาก ต.ค. – ก.ย. เช่น ปีงบประมาณ 2568 หมายถึง ต.ค. 67 – ก.ย. 68" | Everywhere | Same, once per page |
| D9 | **Caveat banners**: results "may be limited by data quality from agencies, check the agency site before citing"; risk "is only a risk indicator, not proof of corruption"; "there are many risk factors the AI cannot detect" | Results, risk boxes, footer of profiles | TOR already has the yellow notice; also add the per-flag "not proof" line and the "verify at source" line |
| D10 | **"Verify at source" footer** on each profile with the e-GP link (`gprocurement.go.th`) | Profiles | Same, plus TOR's evidence-row download, which ACT Ai does not offer |
| D11 | **Tip-off CTA** (red banner linking to a LINE channel) | Home, profiles | TOR has the correction form; extend it to "report additional information" on internal profiles |
| D12 | **Split toggle on count charts**: `แบ่งสัดส่วนตาม ความเสี่ยงทุจริต / สถานะโครงการล่าสุด / วิธีการจัดหา`, with legend checkboxes showing count and % | Agency, contractor | Same on the agency and company "work with government" sections |
| D13 | **Choropleth map by province** with a measure selector and a "flagged only" checkbox | Agency, contractor | P2; needs a Thailand province TopoJSON. A sorted province bar list is a fine first version |
| D14 | **Home "what this site does" in three numbered steps**: 1 search, 2 check risks, 3 understand procurement | procurement home | Rework TOR home in the same order: search, findings, methodology |
| D15 | **Monthly highlights**: new projects this month, top project by budget, top agency by budget, top contractor by contract value | procurement home | Same, from `analytics.sqlite3` |
| D16 | **Keyword examples for the latest fiscal year**: "projects containing 'ก่อสร้างถนน': 8,352 projects, ฿34.4bn", each linking to a pre-filtered search | procurement home | Same; pick about 10 keywords and refresh them when analytics is rebuilt |
| D17 | **Random example with "สุ่มใหม่"**: one flagged project and one flagged contractor, reshuffled on click | procurement home | Same, drawn from published cases or high-severity flags |
| D18 | **Learn page** as an accordion: what procurement is, who is involved, the process, each method with a "simple" and a "detailed" explanation, budget vs reference price vs contract value, what to look for | `/learn` | Extend TOR `#about` into the same structure |
| D19 | **Each stat headline uses a big number plus a unit line**: `งบประมาณรวม (บาท) 2,721,400.00`, `ต่ำกว่าราคากลางรวม 15.81%` in an accent colour | Project overview | Same; percentage deltas get an icon and wording, not colour alone |

---

## 3. Information inventory by page

### 3.1 Home / landing

| Information | ACT Ai | TOR data | Status |
|---|---|---|---|
| Data scope: years covered, number of projects, agencies, contractors | Yes | `/api/stats` | **Have** (shown) |
| Link to "tips and limitations of search" | Yes | `#about` | **Have** |
| New projects this month, plus agencies and contractors involved | Yes | contract dates in `contracts.raw` (`วันที่เกิดรายการ`, `วันที่ลงนามในสัญญา`) | **Derive**: monthly rollup in `build_analytics.py` |
| Top project by budget (this month / latest FY) | Yes | `วงเงินงบประมาณ (บาท)` | **Derive** |
| Top agency by budget with project count and flagged count | Yes | `agency_year` | **Have** |
| Top contractor by contract value with flagged badge | Yes | `company_year` | **Have** |
| Keyword cards (count and total for latest FY) | Yes | title search over contracts | **Derive**: precompute about 10 keywords at build time |
| Random flagged project / contractor examples | Yes | flags table (see §4) | **Derive** after flags exist |
| Explainer teasers to the learn page | Yes | static | **Have** (`#about`), needs extending |

### 3.2 Search results

| Information | ACT Ai | TOR data | Status |
|---|---|---|---|
| Tabs by entity type with counts | Yes | `/api/projects`, `/companies`, `/people`, `/agencies` | **Have** (as separate lists); merge into one results page |
| Project row: title, province, FY (announce date), agency, project number, budget, flagged badge | Yes | `contracts.raw` has all except the flag | **Have**; flag is **Derive** |
| Agency row: location, total projects, flagged count (%), total budget | Yes | `agency_year`, `agency_stats` | **Have**; flagged % is **Derive** |
| Contractor row: location, projects won, total contract value, flagged badge | Yes | `company_year`, DBD address | **Have** |
| Summary strip: matching projects, total budget, % flagged, number of agencies, number of contractors | Yes | aggregate over the filtered query | **Derive** (watch query cost; cap or precompute) |
| Filters: FY range, location, status, method, type, contractor type, budget range, contract range, flagged only | Yes | `ปีงบประมาณ`, `จังหวัด`, `สถานะโครงการ`, `ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง`, `ชื่อประเภทโครงการ`, `วงเงินงบประมาณ`, `ราคาที่ตกลงซื้อ/จ้าง`; contractor type from the legal-form prefix or DBD `jpType` | **Derive**: needs indexed columns or a search table (see roadmap 4.3 full-text index) |
| Sort: relevance, date, budget, contract value | Yes | as above | **Derive** |
| CSV download of the whole result, copy link | Yes | — | **Derive** (stream CSV, max N rows) |
| Overview tab for a result set (charts over the matches) | Yes (`ภาพรวม`) | — | P2 |

### 3.3 Project page

ACT Ai sections: **ภาพรวม → ข้อมูลเจาะลึก (participants per stage, winners, bids) → เอกสารที่เกี่ยวข้อง**.

| Information | ACT Ai | TOR data (`contracts.raw` / `bids.raw` field) | Status |
|---|---|---|---|
| Project title, project number | Yes | `ชื่อโครงการจัดซื้อจัดจ้าง`, `รหัสโครงการ` | **Have** |
| Last updated date | Yes | source file date (`as_of`) | **Have** (global); per-project is **Derive** from source member |
| Risk box: number of flags and their names | Yes | — | **Derive** (§4) |
| Total budget | Yes | `วงเงินงบประมาณ (บาท)` | **Have** |
| Reference price (ราคากลาง) | Yes | `ราคากลาง (บาท)` | **Have** in raw; not shown yet |
| Contract value total | Yes | `ราคาที่ตกลงซื้อ / จ้าง ซึ่งรวมทุกสัญญาในโครงการ (บาท)` | **Have** |
| % below budget, % below reference price | Yes | computed from the three numbers | **Derive** (S) |
| Project location (falls back to the agency's location, with a note) | Yes | `จังหวัด`, `เขต/อำเภอ`, `แขวง/ตำบล`; `ละติจูด/ลองจิจูด` mostly empty | **Have** |
| Announce date, fiscal year | Yes | `วันที่ประกาศจัดซื้อจัดจ้าง` (often "-"), `วันที่เกิดรายการ`, `ปีงบประมาณ` | **Have** |
| Project status | Yes | `สถานะโครงการ` | **Have** |
| Owner agency and its location | Yes | `ชื่อหน่วยงาน`, `ชื่อหน่วยงานย่อย` | **Have** |
| Procurement method with explainer, procurement type | Yes | `ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง`, `ชื่อประเภทโครงการ` | **Have** |
| Winners (can be more than one) | Yes | contract rows per project | **Have** |
| Participants per stage: ซื้อซอง, ยื่นซอง, ผ่านคุณสมบัติ, เข้าเสนอราคา (count and names) | Yes | only bidders with prices | **Missing** for the first three stages; "เข้าเสนอราคา" is **Have** |
| Winners table: contractor, tax ID, contract control number, contract number, sign date, contract status, contract value | Yes | `เลขที่สัญญา`, `วันที่ลงนามในสัญญา`, `วันที่สิ้นสุดสัญญา`, `สถานะสัญญา`, `วงเงินงบประมาณในสัญญา` | **Have** (no control number) |
| Bids table per evaluated item: bidder, tax ID, bid price, gap to winner (%), gap to reference price (%), winner marker | Yes | `bids`: `ชื่อรายการพิจารณา`, `ชื่อผู้เสนอราคา`, `ราคาที่เสนอ (บาท)`; tax ID only when linked | **Derive** (S); reference price is project-level, so the per-item gap is only exact for single-item projects |
| Related documents: price announcement, winner announcement, bid summary, invitation, document buyers, submitters, qualified list, contract summary | Yes (links to e-GP) | — | **Missing**: e-GP document links are not in the data.go.th CSVs |
| CSV download and copy link on each table | Yes | — | **Derive** |

### 3.4 Contractor (company) page

ACT Ai sections: **ข้อมูลทั่วไป → การรับงานกับหน่วยงานรัฐ (count, value, spread, method mix, bidding behaviour) → รายชื่อโครงการที่เกี่ยวข้อง → หน่วยงานรัฐที่เป็นผู้ว่าจ้าง**.

| Information | ACT Ai | TOR data | Status |
|---|---|---|---|
| Name, last updated date, flag box ("ตรวจพบความน่าสนใจ N กรณี") | Yes | `companies`, DBD `updateDate` | **Have**; flags **Derive** |
| Address | Yes | DBD `address`, `locationProvince` | **Have** (DBD-covered companies only) |
| Registration number, registration type, registered capital, registration date | Yes | `jpNo`, `jpType`, `capAmt`, `regDate` | **Have** |
| Business category (TSIC code and name), status | Yes | `businessTypeCode`, `businessType`, `jpStatus` | **Have** |
| Change history | Yes | multiple `registry_observations` per company | **Derive** (diff between observations) |
| Directors / partners, and who can sign for the company | Yes | `registry_roles` (PersonMention), `signing_conditions` | **Have** |
| Financials (not on ACT Ai, but in our DBD data) | No | `totalIncome`, `netProfit`, `totalAsset`, ratios | **Have**: TOR advantage, show income vs public contract value |
| Projects won: total, split by flag / status / method, per FY | Yes | `company_year` and contract rows | **Have**; flag split is **Derive** |
| Contract value: total, split, per FY, with a note that multi-winner projects overstate a single winner's share | Yes | `company_year` | **Have** |
| Spread by province (map) | Yes | contracts `จังหวัด` | **Derive** |
| Bidding funnel: ซื้อซอง → เสนอราคา → ได้งาน, per FY | Yes | bids (เสนอราคา) and contracts (ได้งาน) | **Derive** for bid→win; ซื้อซอง **Missing** |
| Bid behaviour mix: above reference price, 0–1% below, more than 15% below, other | Yes | bids vs `ราคากลาง` | **Derive** |
| Project list with filters (date, status, method, agency, co-bidders, winner, contract value, budget) and CSV | Yes | contracts and bids | **Have** (list); filters and CSV **Derive** |
| Employer agencies table: projects and contract value per agency | Yes | `agency_winner` | **Have** |
| Frequent co-bidders and shared people | No | `cobid_pairs` | **Have**: TOR advantage |
| Relationship graph | No | `/api/entity-graph` | **Have**: TOR advantage |

### 3.5 Agency page

ACT Ai sections: **ภาพรวมโครงการที่จัดทำ (count, budget, spread) → รายชื่อโครงการที่จัดทำ**.

| Information | ACT Ai | TOR data | Status |
|---|---|---|---|
| Name, location, map link, last updated | Yes | agency name; location from contract `จังหวัด` (mode) | **Derive** |
| Project count with split toggle (flag / status / method) and per-FY stacked bars | Yes | `agency_year`, `method_year` | **Have**; flag split **Derive** |
| Budget vs contract value per FY, with the total difference | Yes | budget and agreed price per contract | **Derive** (S): add budget to `agency_year` |
| Spread by province (map, "flagged only" toggle) | Yes | `จังหวัด` | **Derive** |
| Project list with filters and CSV | Yes | contracts by agency | **Have** (list); filters **Derive** |
| Winner concentration (HHI, top winner share) | No | `agency_stats` | **Have**: TOR advantage |
| Specific-method share, near-budget share, single-bid rate with peer percentile | No | `agency_stats` | **Have**: TOR advantage |
| Top contractors for this agency | No | `agency_winner` | **Have** |

### 3.6 Person page (from Politics Data)

ACT Ai only profiles politicians and senior officials who file NACC asset declarations. TOR's person nodes come from the DBD registry, and most are private individuals. So TOR borrows the **layout**, not the asset content, and shows less personal detail (PDPA).

| Information | ACT Ai | TOR data | Status |
|---|---|---|---|
| Name, current position, age at filing, past positions | Yes | DBD role rows (`raw_role`, observation dates) | **Have** (roles); age **Missing** (and not wanted) |
| Financial status (assets, debts, income, spending, by filer / spouse / children) | Yes | — | **Missing**; only relevant if NACC data is added for public officials |
| Businesses linked, with industry code and role | Yes | `registry_roles` → companies | **Have** |
| Government projects of those businesses | Yes ("ความเกี่ยวข้องกับธุรกิจและโครงการภาครัฐ") | contracts via company | **Have** |
| Party donation history (chart, per party, dates, amounts) | Yes | — | **Missing** (ECT data) |
| Relatives disclosed in declarations | Yes | — | **Missing**; do not add for private individuals |
| Court cases, NACC rulings | Yes | — | **Missing** |
| Link to parliamentary record (theyworkforus.wevis.info) | Yes | — | P2 link-out for MPs |

### 3.7 Learn / methodology

ACT Ai's `/learn` covers:
- what public procurement is
- who is involved
- the process
- each procurement method (e-market with RFQ and Thai Auction, e-bidding, สอบราคา, คัดเลือก, เฉพาะเจาะจง), each with a simple and a detailed explanation and the baht thresholds
- choosing a method
- budget, reference price and contract value, including the six sources of a reference price
- what to look for: the full list of risk rules

TOR `#about` today covers the method and its limitations. It should add the procurement basics and **one entry per flag**, each giving:
- the definition
- the exact formula and threshold
- the data fields used
- known false positives

### 3.8 Open data

opendata.actai.co is a CKAN catalogue:
- tag cloud (นิติบุคคล, จัดซื้อจัดจ้าง, ผู้ทิ้งงาน, ราคากลาง, …)
- dataset count
- a Q&A section: what open data is, raw versus processed data, who may use it, commercial use

TOR could publish a small catalogue:
- `analytics.sqlite3` tables as CSV
- flags per project
- published case snapshots

Each would carry a licence and a data dictionary. This is P2 and needs a decision on licence and PDPA first.

---

## 4. Risk-flag catalogue

ACT Ai lists 23 rules on `/learn`. Three are listed twice, so there are 20 distinct rules in three groups. Note that **ACT Ai labels projects "พบความเสี่ยงทุจริต"** (risk of corruption found). TOR should keep its neutral wording, **"ข้อสังเกต"** (observation). Each flag should show the numbers that triggered it, a link to the evidence row, and "ไม่ได้หมายความว่ามีการทุจริต" (this does not mean corruption occurred).

### 4.1 Bidding behaviour (per project / item)

| # | ACT Ai rule | Proposed TOR definition | Fields | Status | Pri / Effort |
|---|---|---|---|---|---|
| R1 | เสนอราคาใกล้ราคากลาง | Winning bid is 0–1% below the reference price | winning `ราคาที่เสนอ`, `ราคากลาง` | **Derive** | P0 / S |
| R2 | เสนอราคาสูงกว่าราคากลาง | Any bid above the reference price; contractor page counts how often | bids, `ราคากลาง` | **Derive** | P0 / S |
| R3 | เสนอราคาสูง | ACT Ai gives no definition; propose winning bid ≥ 95% of the reference price on competitive methods | same | **Derive** (define first) | P2 / S |
| R4 | เสนอราคาเกาะกลุ่ม | ≥ 3 bids on an item and the bids' coefficient of variation < 1% | bids per item | **Derive** | P1 / S |
| R5 | เสนอราคาเท่ากัน | Two or more different bidders with the same price on one item | bids per item | **Derive** | P1 / S |
| R6 | เสนอราคาต่ำกว่าราคากลางผิดปกติ | Winning bid more than 15% below the reference price (ACT Ai's contractor chart uses 15%) | bids, `ราคากลาง` | **Derive** | P1 / S |
| R7 | เสนอราคาต่ำกว่าผู้เสนอรายอื่นผิดปกติ | Gap between winner and runner-up more than 15% of the runner-up's price | bids per item | **Derive** | P1 / S |
| R8 | มูลค่าสัญญาสูงกว่าราคาประมูลชนะ | Contract value > winning bid by more than 1% | `ราคาที่ตกลงซื้อ/จ้าง`, winning bid | **Derive** (single-item projects first) | P0 / S |
| R9 | มีผู้เสนอราคาน้อยกว่า 3 ราย | Competitive method (e-bidding, คัดเลือก) with fewer than 3 distinct bidders | bids, `ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง` | **Have** in part (`single_bid`), extend to < 3 | P0 / S |
| R10 | คู่เทียบมีกรรมการหรือที่อยู่เดียวกัน | Bidders on the same item share a director/partner (DBD) or the same normalised address | `registry_roles`, DBD `address` | **Have** for shared people (`cobid_pairs.shared_people`); address **Derive**. Limited by DBD coverage (4.5% of contracts) | P0 / M |
| R11 | คู่เทียบเคยเสนอราคาด้วยกันบ่อยครั้ง | Pair in `cobid_pairs` (≥ 5 shared projects) | `cobid_pairs` | **Have** | done |
| R12 | ผู้เข้าเสนอราคามีประวัติทิ้งงาน | Bidder on the debarment list (บัญชีรายชื่อผู้ทิ้งงาน) at bid date | — | **Missing**: needs the e-GP debarment list | P1 / M |

### 4.2 Agency transparency (per project)

| # | ACT Ai rule | Proposed TOR definition | Fields | Status | Pri / Effort |
|---|---|---|---|---|---|
| R13 | ราคากลางสูง/ต่ำกว่างบประมาณ | Reference price differs from budget by more than X% (propose ±10%), or is above budget | `ราคากลาง`, `วงเงินงบประมาณ` | **Derive** | P1 / S |
| R14 | เฉพาะเจาะจงท้ายปีงบประมาณ | Specific-method contract dated in August or September (last 2 months of the FY); agency-level share compared with its own average | `ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง`, `วันที่เกิดรายการ` / `วันที่ลงนามในสัญญา` | **Derive** (parse Thai short dates) | P1 / S |
| R15 | เฉพาะเจาะจงที่ส่อหั่นสัญญา | Same agency, same winner, ≥ 2 specific-method contracts within 30 days, each ≤ 500,000 baht, together > 500,000 baht | contracts | **Derive** | P0 / M |

### 4.3 Contractor (per company)

| # | ACT Ai rule | TOR status | Pri / Effort |
|---|---|---|---|
| R16 | Company address matches the address of a politician or official who files asset declarations | **Missing** (NACC declarations) | P2 / L |
| R17 | Director is or was a politician or senior official who files declarations | **Missing** (NACC, ราชกิจจานุเบกษา appointment lists) | P2 / L |
| R18 | Director is a relative of a politician or official who files declarations | **Missing** (NACC relative lists) | P2 / L |
| R19 | Company has donated to a political party | **Missing** (ECT donation data) | P1 / M |
| R20 | Company is on the debarment list | **Missing** (same source as R12) | P1 / M |

### 4.4 Flags TOR already has that ACT Ai does not show

- **Winner concentration per agency:** HHI and top-winner share, with a peer percentile
- **Agency share of specific-method contracts:** with a peer percentile
- **Contracts priced at ≥ 99% of budget:** agency share
- **Single-bidder rate per agency:** with a peer percentile
- **Co-bidding pairs with shared people:** includes the winner split (A wins / B wins), which suggests bid rotation
- **Multi-hop relationship graph:** confidence levels and human review on every edge

### 4.5 Implementation note

Add a `flags` stage to `pipeline/build_analytics.py`:
- **Tables:** `project_flags(pid, rule, severity, value, threshold, evidence_seq)` and a rollup `company_flags(cid, rule, count)`.
- **Run:** compute R1, R2, R4–R9, R13–R15 in the existing per-year workers. They need only `contracts` and `bids` for the same `pid`.
- **API:** `/api/flags?pid=` and `/api/flags/company?cid=`.
- **UI:** show the flag box on profiles; add a `flagged` filter to search.
- **Tests:** unit tests on hand-made bid sets for every rule.

---

## 5. Where TOR should differ on purpose

1. **Evidence first.** ACT Ai shows numbers and links to e-GP; TOR links each fact to the exact source row and lets the user download it. Keep this visible on every flag and table.
2. **Identity confidence.** ACT Ai shows bidders by name with no matching caveat. TOR distinguishes tax-ID matches from name-only matches and asks a reviewer to confirm. Keep the confirmed/unconfirmed styling in tables too, not just the graph.
3. **Wording.** Use "ข้อสังเกต" (observation) and "รูปแบบที่ควรตรวจสอบต่อ" (pattern worth checking further), not "เสี่ยงทุจริต" (corruption risk), in line with the TOR proposal and PDPA.
4. **People.** Most TOR person nodes are private individuals from the DBD registry. Show their names and company roles only; no age, address or relatives.
5. **Publication.** ACT Ai shows everything publicly; TOR publishes only reviewed cases. The internal app can show flags, but the public portal shows only flags inside published cases.

---

## 6. Recommended page plan for TOR

| Page | Sections (in order) | Builds on | Pri / Effort |
|---|---|---|---|
| **Home** | Search hero with scope line · this month (new projects, top project, top agency, top contractor) · keyword cards for latest FY · random flagged example with "สุ่มใหม่" · 3 steps (search, observations, methodology) | D14–D17, §3.1 | P1 / M |
| **Search results** | Entity tabs with counts · summary strip · filter panel · sort · list · CSV and copy link | D2–D5, §3.2 | P0 / M |
| **Project** (full page) | Header with observation box · overview figures (budget, reference price, contract, % gaps) · details (location, dates, FY, status, agency, method, type) · winners/contracts table · bids per item with gaps · evidence rows and source files · open in graph | D6, D7, D19, §3.3, R1–R9, R13–R15 | P0 / M |
| **Company** | Header with observation box · general (DBD) · directors and signing authority · change history · financials vs public contract value · work with government (counts, values, provinces, method mix, bid behaviour, funnel) · projects table · agencies table · co-bidders · open in graph | §3.4 | P0 / M |
| **Agency** | Header · project counts with split toggle · budget vs contract per FY · province spread · concentration and peer percentiles · top contractors · projects table · open in graph | §3.5 | P0 / M |
| **Person** | Header · company roles timeline · companies' government work · co-directors · open in graph | §3.6 | P1 / S |
| **Methodology** (`#about`) | Procurement basics · methods and thresholds · budget vs reference vs contract · one entry per observation rule · data sources and update dates · limitations | D18, §3.7 | P0 / S |
| **Open data** | Dataset list with dictionary, licence, update date | §3.8 | P2 / M |

The graph stays the centre of investigation. Profiles are the readable, citable view of one entity, and every profile has "เปิดแผนผัง" (open graph).

---

## 7. Data to acquire

| Data | Source | Unlocks | Pri |
|---|---|---|---|
| Debarment list (บัญชีรายชื่อผู้ทิ้งงาน) | gprocurement.go.th | R12, R20 | P1 |
| More DBD registry coverage (today about 4.5% of contracts link to a DBD record) | DBD DataWarehouse+ | R10 address match, company pages, shared-director pairs | P0 |
| e-GP stage lists (buyers, submitters, qualified) and announcement documents | e-GP project pages | Participant funnel, document links | P2 (scraping, licence check) |
| Contracts before FY 2565 | data.go.th e-GP archives | Long-term trends, ACT Ai parity on years | P1 |
| Party donations | ECT (กกต.) | R19 | P2 |
| NACC asset declarations, appointment lists | asset.nacc.go.th, ราชกิจจานุเบกษา | R16–R18 | P2 |
| Province boundaries (TopoJSON) | public GIS | Province maps (D13) | P2 |

---

## 8. Suggested order of work

1. **Flags pipeline** for R1, R2, R8, R9 and R15, plus the methodology entries for each (P0, about 1 week).
2. **Full-page project profile** with the bids-per-item table and the observation box (P0, about 1 week).
3. **Unified search results** with filters, summary strip and CSV (P0, about 1 week; depends on the full-text/search index from the roadmap, section 4.3).
4. **Company and agency profiles** using existing analytics tables (P0, about 1 week).
5. **Home page rework** (P1, a few days).
6. **R4–R7, R13, R14** and the R10 address match (P1).
7. **Debarment list and DBD coverage** (P1, data work).
