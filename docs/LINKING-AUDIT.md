# Linking audit — procurement.sqlite3

Audited: 31 Oct 2026 (2569) · Method: read-only queries over `output/linked-data/procurement.sqlite3` (24,956,780 contract rows, 6,063,203 bid rows, 89,553 DBD observations) plus a check of every source file on disk. Nothing in the database was changed.

The audit script is `scratchpad/audit_links.py` in the session folder; its raw output is the `audit_links.json` next to it. The checks are simple enough to rerun after any re-link.

## 1. Verdict in one table

| Link | Verdict | Evidence |
|---|---|---|
| Source files → database | **Complete** | All 9 Data.go.th archives imported. The ZIP nested inside `2569-egp-contract.zip` is byte-identical (same CRC per member) to the standalone 2569 bid archive, so nothing was missed or double-counted |
| DBD folders → registry | **Complete** | 89,553 folders = 89,553 observations; every folder has `company.json`; 0 import errors; 0 invalid IDs |
| Exact duplicate contract rows | **None** | 0 content-hash groups with more than one row |
| Contract winner ID → DBD company | **Correct, low coverage** | 98.5% of the 1,119,779 linked rows carry the same name as the registry (1,082,353 identical + 21,204 identical after dropping the legal form). The other 16,222 (1.4%) are spelling variants or companies renamed since the contract; the ID link itself is right |
| Bidder name → company ID | **Correct where made, 44% unresolved** | See §3 |
| Winner name present among the project's bidders | **Correct** | 99.9% of winners with a valid ID appear among the bidders of the same project |
| Registry people across companies | **Correct, 15% not linkable** | 160,052 roles have a person-ID hash; 27,314 have no ID in the source |
| Agency identity | **Wrong for about 2% of rows** | See §5 |

## 2. Contract winner IDs (24,956,780 rows)

| Kind of ID | Rows | Share |
|---|---:|---:|
| Valid 13-digit ID, in DBD registry | 1,119,779 | 4.5% |
| Valid 13-digit ID, not in the registry (154,824 distinct IDs) | 13,237,558 | 53.0% |
| Masked: nine digits + `xxxx` (88,055 distinct) | 10,598,563 | 42.5% |
| Other malformed (`D` + 12 digits, 12 digits, bad checksum) | 883 | <0.01% |

**The masked rows are individuals, not companies.** They start with 1, 2, 3, 4, 5 or 8 (national-ID prefixes) and only one row starts with 0 (the juristic-person prefix). The publisher masks the last four digits of personal IDs on purpose. None of the 88,055 masked values shares a nine-digit prefix with any known company ID.

**Recommendation: do not try to unmask them.** It would re-identify people the source deliberately hid. For a stable pseudonymous key, use the nine visible digits together with the name.

**The real gap on the company side is DBD coverage.** The registry covers 11,807 of 166,631 contracted company IDs and only 7.3% of the contract value that carries a valid ID. [`dbd-fetch-worklist.csv`](dbd-fetch-worklist.csv) lists the 154,845 missing IDs by contract value. Fetching the first 5,000 would cover 78% of the uncovered value, the first 20,000 would cover 94%.

## 3. Bidders (6,063,203 rows)

| Link method | Rows | Share |
|---|---:|---:|
| `same_project_winner_name` | 3,379,313 | 55.7% |
| `unique_registry_name_unverified` | 23,832 | 0.4% |
| `ambiguous_project_winner` | 1 | 0% |
| `unresolved_name` | 2,660,057 | 43.9% |

**What a re-link can recover** from the 2,660,057 unresolved rows, using only the official name→ID pairs that already exist in the 25 million contract rows:

| Rule | Rows | Notes |
|---|---:|---|
| Exact name seen as a winner with exactly one valid ID | 387,532 | Medium confidence: the identical name could belong to two companies |
| Same, after dropping the legal form (บริษัท / จำกัด / หจก.) | 18,988 | Lower confidence |
| Name seen with several IDs | 51,401 | A "dominant ID" rule (one ID has at least 95% of the rows) would recover most; the minority IDs are tiny and mostly start with 0994 |
| **Still unresolved** | **2,202,136** | Shops and individuals who never won with a visible ID (for example "ก.สหภัณฑ์พานิช", "B.K.กิ๊ฟช๊อป") |

A re-link raises the share of bid rows with an ID from 56.1% to about 63–64%. The rest cannot be linked from the data we hold, and should stay as names.

**Bid coverage by project year** (the bid files are named 2566–2569, but the project IDs inside show where the data really is):

| Project year (first two digits of the ID) | Bid rows |
|---|---:|
| 2569 | 4,289,424 |
| 2568 | 1,762,665 |
| 2567 | 10,901 |
| 2566 and older | 213 |

So bid-based indicators (single bidder, co-bidding pairs) describe **fiscal years 2568–2569 only**. The dashboard and methodology page must say so.

## 4. Names and IDs

- 4,964 winner names are tied to more than one ID in the contracts (4,975,495 rows, 20%). Nearly all are one dominant ID plus a handful of stray rows, for example 561,533 rows on the right ID and 5 on another. The strays are usually IDs starting 0994, which look like data-entry errors at the agency.
- 18,797 IDs appear under more than one spelling of the name.
- **Name normalisation misses these variants**, which is why 21,204 + 16,222 registry-linked rows differ from the registry name:
  - Thai digits against Arabic digits (กิจธนาทรัพย์๑๖๘ against 168)
  - "(สำนักงานใหญ่)" suffix
  - abbreviations บ. / บจ. / บจก. / หจก.
  - slash notes after the name ("…/โรงแรมกรุงศรีริเวอร์")
  - common spelling pairs (เอเซีย / เอเชีย, ฯ)
- Renamed companies appear under the old name in older contracts while the registry holds the latest name. That is normal and the ID link is still right.

## 5. Agencies

- 73,843 raw agency names; whitespace and Unicode normalisation merges only 165 groups.
- **The agency field is the sub-agency, without its parent.** On two sampled source files, 1.6–2.0% of rows carry a sub-agency name that is used under more than one parent. Examples:
  - "คณะวิทยาศาสตร์และเทคโนโลยี" is used by 11 universities
  - "กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค" by 6 hospitals
  - "คณะแพทยศาสตร์" by 3 universities

  Their agency pages and concentration figures mix different organisations.
- The agency page, `agency_year`, `agency_stats` and the agency graph all key on this field.
- Fix: key an agency on parent plus sub-agency whenever the two differ. That adds `ชื่อหน่วยงาน` to the key, which is in the raw row but not in a column.

## 6. Registry people

- 160,052 of 187,366 person roles (85.4%) have a person-ID hash and link across companies; 11,224 hashes appear in more than one company.
- 27,314 roles have no ID in the source. They are never merged by name, which is the safe choice.
- 860 of those names appear in more than one company (1,962 company links). At most, offer them to a reviewer as "possibly the same person" candidates. Never merge them automatically.

## 7. Defects in my own analytics (`pipeline/build_analytics.py`)

1. Masked winners are keyed `name:<name>` (line 52), so two different people with the same name merge, and the same person's masked rows never join their unmasked rows. Use `masked:<nine digits>:<name>` for masked IDs.
2. Agency key ignores the parent (§5).
3. Bid-based indicators cover only fiscal years 2568–2569 (§3) but are presented as dataset-wide.

## 8. Result of the re-link (done)

Run with `python pipeline/relink_identity.py` (about 6 minutes). It reads `procurement.sqlite3` read-only and writes the new file `identity.sqlite3`; the 52 GB database is untouched.

| Item | Result |
|---|---|
| Bidder rows with an ID | 3,403,145 (56.1%) before, **3,809,461 (62.8%)** after: 406,316 added |
| of which `contract_name_unique_unverified` | 387,532 |
| of which `contract_name_dominant_unverified` | 12,810 |
| of which `contract_name_v2_unverified` | 5,491 |
| of which `registry_name_v2_unverified` | 483 |
| Still name-only | 2,253,742 (37.2%), mostly shops and individuals |
| Sub-agency names shared by several parents | 362 names (322,287 rows, 1.3%) |
| Same-name people in several companies | 936 groups (2,147 role rows) for the reviewer queue |

The v2 rule added fewer rows than the 18,988 estimated in §3: the estimate dropped the legal form entirely, but the final rule keeps it as a tag so a company and a partnership with the same core name are never joined. Only 1,440 of the added links point to a company that is in the DBD registry; the rest point to IDs that have no registry record yet (see `dbd-fetch-worklist.csv`).

What changed in the app:
- Bidder edges from the new links appear in graphs with low confidence and the label "ยังไม่ยืนยัน"; they are excluded from published cases unless a reviewer marks the edge correct.
- Graph nodes and dashboard rows for a shared sub-agency name are written `ชื่อ (หน่วยงานแม่)`.
- Winners with masked IDs are keyed by a hash of the nine visible digits plus the name (never shown, never unmasked).
- The review page has a "คนชื่อซ้ำ" tab; a group marked "same person" becomes one node in graphs and published cases.
- The dashboard and `#about` say that bid data covers fiscal years 2568–2569 only.

## 9. Still to do (needs data or a decision)

| # | Item | Why it is not done |
|---|---|---|
| 1 | Fetch the first 5,000–20,000 DBD companies from [`dbd-fetch-worklist.csv`](dbd-fetch-worklist.csv) | Needs your DBD fetcher; it lifts registry coverage of contract value from 7% to about 80–90% |
| 2 | Re-run `relink_identity.py` and `build_analytics.py` after new DBD data or a new contract import | Both are rerunnable; the link counts will change |
| 3 | Fuzzy matching for spelling variants (เอเซีย / เอเชีย) | Needs a reviewer queue; automatic links would be unsafe |
| 4 | An official agency code list | Needs an outside data source |
| 5 | Bid data before fiscal year 2568 | Not in the source files |

Not recommended: unmasking personal IDs, merging people by name alone, or treating a name-only bidder match as a confirmed identity.
