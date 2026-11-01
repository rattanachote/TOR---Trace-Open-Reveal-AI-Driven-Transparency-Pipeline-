# Problems found while linking the data, and how each is handled

Companion to [LINKING-AUDIT.md](LINKING-AUDIT.md) (the verdict per link). This file lists every problem met while linking bidders, winners, companies, agencies and people, with the measured size, the fix, and what is deliberately left alone.

Counts are distinct names or rows in `procurement.sqlite3` on 31 Oct 2026 (2569). The rules live in [`backend/services/namekey.py`](../backend/services/namekey.py), tested in `tests/test_namekey.py`. The second linking pass is `pipeline/relink_identity.py`; it writes `identity.sqlite3` and never touches the 52 GB database.

## A. Name differences that are cosmetic (fixed by the v2 name key)

Bidders carry only a name. The same company is written in many ways, so exact matching misses it. Each row below is a class of difference, how common it is, and the rule.

| # | Problem | Example | Distinct bid names / winner names | Rule in `namekey.v2` |
|---|---|---|---:|---|
| A1 | **Thai digits** instead of Arabic | `กิจธนาทรัพย์๑๖๘` against `กิจธนาทรัพย์168` | 1,400 / 2,255 | Map ๐–๙ to 0–9 |
| A2 | **Head-office note** | `ซีเจโชคเจริญ (สำนักงานใหญ่)` against `ซีเจโชคเจริญ` | 4,423 / 7,581 | Drop `(สำนักงานใหญ่)` and `สำนักงานใหญ่` |
| A3 | **Branch note** after the legal form | `บริษัท เอ จำกัด สาขาขอนแก่น` against `บริษัท เอ จำกัด` | 1,462 / 2,615 | Drop `สาขา…` only when it follows a legal form or a closing bracket, so names such as `ศูนย์สาขาวิชา…` are kept |
| A4 | **Abbreviated company form** | `บ.โกโกหัวหิน…`, `บจ.โกทูเทค`, `บจก.`, `บมจ.` | 448 / 842 | Expand `บ.` `บจ.` `บจก.` `บมจ.` to the form tag `co` / `pcl` |
| A5 | **Abbreviated partnership form** | `หจก.`, `หจก`, `ห.จ.ก.`, `หสน.` | 3,295 / 5,871 | Map to the form tag `lp` (limited partnership) or `gp` (ordinary) |
| A6 | **Legal form written before, after, or twice** | `บริษัท … จำกัด`, `… จำกัด`, `บริษัท … บริษัท … จำกัด` | 59,740 / 97,123 carry a prefix; 440 / 1,325 are doubled | The form is read from prefix or suffix and kept as a tag; the core name is compared |
| A7 | **Public-company marker** | `จำกัด (มหาชน)`, `(มหาชน)`, `บริษัทมหาชนจำกัด` | 591 / 896 | Any of these gives the tag `pcl` |
| A8 | **Whitespace and punctuation** | double spaces, `B.K.กิ๊ฟช๊อป` against `BK กิ๊ฟช๊อป`, leading `.` or `,` | 15 / 34 leading punctuation | Remove whitespace (already in v1) and `. , - " ' “ ”` |
| A9 | **Sara am written as two characters** | `จํากัด` (nikhahit + sara aa) | everywhere | NFKC already normalises it the same way on both sides; keys store the decomposed form |
| A10 | **Zero-width characters** | invisible `U+200B` | few | Removed |

**Search uses the same ideas.** `services/textnorm.py` now turns Thai digits in a search term into Arabic digits and queries both spellings (`like_any`), so `กิจธนาทรัพย์168` finds `กิจธนาทรัพย์๑๖๘` and the reverse. An abbreviation typed without a space (`บจก.โกทูเทค`, `หจก.…`, `บมจ.`, `หสน.`, `บจ.`) is dropped from the term, like a title already was; the stored name still matches because LIKE finds the core inside it.

**Why the legal form is kept as a tag, not removed.** `บริษัท เอ จำกัด` and `ห้างหุ้นส่วนจำกัด เอ` are different legal entities with the same core name. The v2 key is `<form>:<core>`, so they never match each other. A name with no legal form (a shop or an individual) has the empty tag and only matches another bare name.

**Measured gain.** Only 5,491 + 483 extra bid rows are linked by v2 (against about 19,000 in a looser trial that dropped the tag). The looser trial was rejected: it would have joined different entity types.

## B. Differences that are **not** cosmetic (left alone, on purpose)

| # | Problem | Example | Why it stays unmatched |
|---|---|---|---|
| B1 | **Spelling variants** | `เอเซีย` / `เอเชีย`, `ปิโตรเลียม` / `ปิโตเลียม`, `เอ็กซ์เพรส` / `เอ๊กซ์เพรส` | Matching these needs fuzzy search, which cannot tell two similar company names apart. Candidates for a reviewer queue later, not for automatic links |
| B2 | **Renamed company** | contract says `918 แอนด์ พีเอส อิเล็กทรอนิกส์`; registry says `918 สมาร์ทโซลูชั่นส์` | The ID link is right; only the name changed. Compare by ID, never by name, when an ID exists |
| B3 | **Trade name of an individual** | `B.D.คอมพิวเตอร์ โดย นายปรัชพันธ์…` (17,354 bid names / 29,177 winner names) | The shop and the owner are written together and the owner is masked; no ID is available |
| B4 | **Names with only Latin letters** | `SSP`, `CPP TRADING` (1,792 / 4,496) | Too short or generic; a core of fewer than 3 characters is never matched |
| B5 | **Slash notes** | `บริษัท ก.พัชรศักดิ์ จำกัด/โรงแรมกรุงศรีริเวอร์` (1,045 / 1,790) | A `/` also appears inside real names such as joint ventures, so it is not stripped |
| B6 | **Joint ventures** | `กิจการร่วมค้า …` (589 / 1,491) | Tagged `jv`; the ID is often a 0994… tax number, not a DBD company |

## C. One name, several IDs (and one ID, several names)

| # | Problem | Size | Handling |
|---|---|---|---|
| C1 | A winner name used with **more than one ID** in the contracts | 4,964 names (4,975,495 rows) | Almost always one ID holds nearly every row, for example 561,533 rows on the true ID and 5 on another. The minority IDs usually start `0994` and look like entry errors at the agency |
| C2 | Rule for C1 | — | "Dominant ID": the top ID has at least 95% of the name's rows and at least 20 rows. 12,810 bid rows linked this way, tagged `contract_name_dominant_unverified`. A name with no dominant ID is skipped |
| C3 | An ID seen under **several spellings** | 18,797 IDs | Fine for linking by ID. Only matters when going from a name to an ID, where it makes a name look ambiguous when it is not |
| C4 | A **unique** name that holds one ID | 387,532 bid rows | Linked as `contract_name_unique_unverified`. Two companies could share an exact name, so this is a lead, not a confirmed identity |

## D. People and IDs

| # | Problem | Size | Handling |
|---|---|---|---|
| D1 | **Masked personal ID**: nine digits + `xxxx` | 10,598,563 contract rows (42.5%) | Never unmasked. These are national IDs of individuals; the publisher hides them on purpose. Analytics now keys such a winner as `masked:<hash of the nine digits>:<name>`, so two people with one name stay apart and no digit is shown |
| D2 | **Unmasked personal IDs** (a privacy leak in the source) | 0 found: every valid 13-digit ID starts with 0 | Checked; nothing to remove |
| D3 | **Winner with no registry record** | 13,237,558 rows (154,824 IDs) | DBD coverage, not a linking error. [`dbd-fetch-worklist.csv`](dbd-fetch-worklist.csv) lists them by contract value |
| D4 | **Director with no ID** in the registry | 27,314 of 187,366 roles | Never merged by name alone |
| D5 | Same first + last name in several companies, no ID | 860 names, 1,962 company links | A reviewer queue ("คนชื่อซ้ำ" tab). A confirmed group becomes one person in the graph and in published cases; a rejected group never joins |
| D6 | Title differences (`นาย`, `ร้อยตรี`, `ดร.`) | — | Titles are dropped when grouping names for D5; at least two name words are required |

## E. Agencies

| # | Problem | Size | Handling |
|---|---|---|---|
| E1 | **Sub-agency without its parent**: `คณะวิทยาศาสตร์และเทคโนโลยี` is used by 11 universities | 1.6–2.0% of rows in two sampled files | `agency_ambiguous` lists the shared names; graph nodes and analytics now show `คณะ… (มหาวิทยาลัย…)` for them. A sub-agency that equals one of its own parents is one agency with an ancestor, not a collision |
| E2 | **Spacing variants** of one agency | 165 groups | Analytics collapses repeated spaces and trims; the agency API accepts either form |
| E4 | **Numeric code in front of a name** (`1034710066 โรงเรียน…`) | 5 names, 313 rows | Left as is: no name appears both with and without a code, so nothing is split |
| E3 | **No official agency code** | all 73,843 names | Still grouped by name. Needs an official code list; see the roadmap |

## F. Coverage gaps in the sources (not fixable by linking)

| # | Gap | Effect |
|---|---|---|
| F1 | Bid rows exist only for projects of fiscal years **2568 (1,762,665 rows) and 2569 (4,289,424)**, and 10,901 for 2567 | Single-bidder and co-bidding indicators describe 2568–2569 only. The pages now say so |
| F2 | The DBD registry covers 7.3% of contract value | Company pages, shared-director pairs and address checks are thin |
| F3 | Registry roles are a snapshot | They do not prove who held the role on the bid date |
| F4 | e-GP stage lists (buyers, submitters, qualified) are absent | Cannot show the participant funnel |

## G. Link methods and how much to trust them

| Method | Meaning | Confidence in the graph |
|---|---|---|
| `registry_id_match` | Winner's 13-digit ID is in the DBD registry | high |
| `same_project_winner_name` | Bidder's name equals the winner's name in the same project | high |
| `contract_name_unique_unverified` | The exact name has one ID across all contracts | low, needs review |
| `contract_name_dominant_unverified` | One ID holds at least 95% of the name's rows | low, needs review |
| `contract_name_v2_unverified` | Equal after the v2 clean-up | low, needs review |
| `registry_name_v2_unverified` | One registry company has this v2 name | low, needs review |
| `unique_registry_name_unverified` | One registry company has the exact name (from the first import) | low, needs review |
| `unresolved_name` | No ID found | low |
| `confirmed_same_person` | A reviewer decided two registry entries are one person | medium |

Low-confidence links are not shown as confirmed in published cases unless a reviewer marks the edge correct.

## H. Not done

- Fuzzy matching for spelling variants (B1).
- Unmasking personal IDs (D1).
- Merging people by name alone (D4).
- An official agency code list (E3).
- Bid data before fiscal year 2568 (F1).
