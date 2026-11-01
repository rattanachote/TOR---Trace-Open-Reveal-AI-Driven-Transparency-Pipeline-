"""Second linking pass. Reads procurement.sqlite3 (never writes to it) and builds identity.sqlite3.

  bid_links_v2         extra bidder -> company links for bids the import left unresolved
  agency_ambiguous     sub-agency names that are used by several different parent agencies
  same_name_groups /   people named only in the DBD registry (no ID) who appear in several companies;
  same_name_members    reviewers decide whether each group is one person
  meta                 counts and build time

Every link carries its method and is tagged "unverified": it is a lead for a reviewer, not a confirmed identity.
Personal ID numbers are never reconstructed. See docs/LINKING-PROBLEMS-AND-FIXES.md for the rules and numbers.

  python pipeline/relink_identity.py
"""
import hashlib, json, re, sqlite3, sys, time, zlib
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from config import DB, IDENTITY  # noqa: E402
from services.namekey import v1, v2, parse  # noqa: E402
from services.textnorm import tokens  # noqa: E402

DOMINANT_SHARE, DOMINANT_MIN_ROWS = 0.95, 20   # one ID holds >= 95 % of a name's contract rows and >= 20 rows
MIN_CORE = 3                                   # a name core shorter than this is too generic to match
AGENCY_MIN_ROWS = 3                            # a parent must own at least this many rows of a sub-agency name
TMP = IDENTITY.with_suffix('.building')


def ro():
 return sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True, timeout=120)


def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)


def valid_id(s):
 s = str(s or '').strip()
 return len(s) == 13 and s.isascii() and s.isdigit() and (11 - sum(int(s[i]) * (13 - i) for i in range(12)) % 11) % 10 == int(s[-1])


def pick(ids):
 """ids: Counter(cid -> contract rows). Returns (cid, method, rows) or None."""
 if len(ids) == 1:
  cid, n = next(iter(ids.items())); return cid, 'unique', n
 total = sum(ids.values()); cid, n = ids.most_common(1)[0]
 if n >= DOMINANT_MIN_ROWS and n >= DOMINANT_SHARE * total: return cid, 'dominant', n
 return None


# ───────────── 1. bidders ─────────────
def bid_links(out):
 c = ro()
 log('bids: reading winner name -> ID pairs from the contracts')
 by_name = defaultdict(Counter)
 for wk, cid, n in c.execute('SELECT winner_key,cid,COUNT(*) FROM contracts GROUP BY winner_key,cid'):
  if valid_id(cid): by_name[wk][cid] += n
 by_v2 = defaultdict(Counter)
 for wk, ids in by_name.items():
  form, core = parse(wk)
  if len(core) >= MIN_CORE: by_v2[form + ':' + core].update(ids)
 registry = defaultdict(set)   # v2 key -> registry company IDs (names and the legal-form aliases added at import)
 for nk, cid in c.execute('SELECT name_key,cid FROM aliases'):
  form, core = parse(nk)
  if len(core) >= MIN_CORE: registry[form + ':' + core].add(cid)
 log(f'bids: {len(by_name):,} winner names, {len(by_v2):,} v2 keys, {len(registry):,} registry keys')
 decision, tally = {}, Counter()
 def decide(nk):
  ids = by_name.get(nk)
  if ids:
   got = pick(ids)
   if got: return got[0], 'contract_name_' + ('unique' if got[1] == 'unique' else 'dominant') + '_unverified', 'medium', got[2]
   return None
  form, core = parse(nk)
  if len(core) < MIN_CORE: return None
  key = form + ':' + core
  ids = by_v2.get(key)
  if ids:
   got = pick(ids)
   if got: return got[0], 'contract_name_v2_unverified', 'low', got[2]
   return None
  reg = registry.get(key)
  if reg and len(reg) == 1: return next(iter(reg)), 'registry_name_v2_unverified', 'low', 0
  return None
 out.execute('CREATE TABLE bid_links_v2(bid_id INTEGER PRIMARY KEY, cid TEXT NOT NULL, method TEXT NOT NULL, confidence TEXT NOT NULL, support_rows INTEGER NOT NULL) WITHOUT ROWID')
 batch, seen_rows = [], 0
 for bid_id, nk in c.execute("SELECT id,name_key FROM bids WHERE link_method IN ('unresolved_name','ambiguous_project_winner')"):
  seen_rows += 1
  if nk not in decision: decision[nk] = decide(nk)
  d = decision[nk]
  if d: batch.append((bid_id, d[0], d[1], d[2], d[3])); tally[d[1]] += 1
  if len(batch) >= 100000: out.executemany('INSERT INTO bid_links_v2 VALUES(?,?,?,?,?)', batch); batch = []
 out.executemany('INSERT INTO bid_links_v2 VALUES(?,?,?,?,?)', batch)
 out.execute('CREATE INDEX idx_bid_links_cid ON bid_links_v2(cid)')
 total_bids = c.execute('SELECT COUNT(*) FROM bids').fetchone()[0]
 already = c.execute("SELECT COUNT(*) FROM bids WHERE linked_cid IS NOT NULL").fetchone()[0]
 added = sum(tally.values())
 log(f'bids: {seen_rows:,} unresolved rows seen, {added:,} linked {dict(tally)}')
 return {'unresolved_before': seen_rows, 'linked_added': added, 'by_method': dict(tally), 'bid_rows': total_bids,
         'linked_before': already, 'linked_after': already + added, 'share_before': round(already / total_bids, 4), 'share_after': round((already + added) / total_bids, 4)}


# ───────────── 2. agencies ─────────────
def agency_scan(sid):
 c = ro(); seen = defaultdict(Counter)
 for agency, raw in c.execute('SELECT agency,raw FROM contracts WHERE source=?', (sid,)):
  r = json.loads(zlib.decompress(raw))
  sub = (agency or r.get('ชื่อหน่วยงานย่อย') or '').strip(); parent = (r.get('ชื่อหน่วยงาน') or '').strip()
  if sub: seen[(v1(sub), sub)][v1(parent)] += 1
 return {k: dict(v) for k, v in seen.items()}


def agency_ambiguity(out):
 c = ro(); sources = [r[0] for r in c.execute("SELECT id FROM sources WHERE kind='contract' ORDER BY id")]; c.close()
 merged = defaultdict(Counter); display = defaultdict(Counter)
 with ProcessPoolExecutor(max_workers=3) as pool:
  for i, part in enumerate(pool.map(agency_scan, sources), 1):
   for (key, raw), parents in part.items():
    merged[key].update(parents); display[key][raw] += sum(parents.values())
   if i % 10 == 0: log(f'agencies: {i}/{len(sources)} contract files scanned')
 out.execute('CREATE TABLE agency_ambiguous(sub_key TEXT PRIMARY KEY, sub TEXT, rows INTEGER, parents TEXT) WITHOUT ROWID')
 ambiguous = rows_in = 0
 for key, parents in merged.items():
  parents = {p: n for p, n in parents.items() if n >= AGENCY_MIN_ROWS}
  if key in parents or len(parents) < 2: continue  # a sub-agency that is also its own parent is one agency with an ancestor
  total = sum(parents.values()); ambiguous += 1; rows_in += total
  out.execute('INSERT INTO agency_ambiguous VALUES(?,?,?,?)', (key, display[key].most_common(1)[0][0], total, json.dumps(parents, ensure_ascii=False)))
 log(f'agencies: {len(merged):,} sub-agency names, {ambiguous:,} used under several parents ({rows_in:,} rows)')
 return {'sub_agency_names': len(merged), 'ambiguous_names': ambiguous, 'rows_in_ambiguous_names': rows_in}


# ───────────── 3. people named only in the registry ─────────────
def same_name(out):
 c = ro()
 people = defaultdict(list)
 for cid, name, seq, obs, comp in c.execute(
   "SELECT r.cid,r.name,r.source_seq,r.obs,o.company FROM registry_roles r JOIN companies k ON k.cid=r.cid AND k.latest_obs=r.obs "
   "JOIN registry_observations o ON o.id=r.obs WHERE r.entity_key LIKE 'mention:%' AND r.kind='PersonMention'"):
  words = tokens(name)
  if len(words) < 2: continue   # a first name alone is not enough to suggest the same person
  d = json.loads(zlib.decompress(comp))
  people[v1(''.join(words))].append((cid, name, seq, obs, d.get('jpName') or cid, (d.get('locationProvince') or {}).get('pvDesc') or ''))
 out.executescript('''CREATE TABLE same_name_groups(gid TEXT PRIMARY KEY, name_key TEXT, name TEXT, companies INTEGER) WITHOUT ROWID;
  CREATE TABLE same_name_members(gid TEXT, cid TEXT, obs INTEGER, seq TEXT, person_name TEXT, company_name TEXT, province TEXT, PRIMARY KEY(gid,cid,seq)) WITHOUT ROWID;''')
 groups = members = 0
 for key, rows in people.items():
  if len({r[0] for r in rows}) < 2: continue
  gid = hashlib.sha1(key.encode()).hexdigest()[:12]; groups += 1
  out.execute('INSERT INTO same_name_groups VALUES(?,?,?,?)', (gid, key, rows[0][1].strip(), len({r[0] for r in rows})))
  for cid, name, seq, obs, company, province in rows:
   out.execute('INSERT OR IGNORE INTO same_name_members VALUES(?,?,?,?,?,?,?)', (gid, cid, obs, seq, name.strip(), company, province)); members += 1
 log(f'people: {groups:,} same-name groups, {members:,} role rows')
 return {'groups': groups, 'role_rows': members}


def main():
 TMP.unlink(missing_ok=True)
 out = sqlite3.connect(TMP); out.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;')
 stats = {'bids': bid_links(out)}; out.commit()
 stats['agencies'] = agency_ambiguity(out); out.commit()
 stats['people'] = same_name(out); out.commit()
 out.execute('CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT)')
 out.execute('INSERT INTO meta VALUES(?,?)', ('built_at', time.strftime('%Y-%m-%dT%H:%M:%S')))
 out.execute('INSERT INTO meta VALUES(?,?)', ('stats', json.dumps(stats, ensure_ascii=False)))
 out.commit(); out.close()
 IDENTITY.unlink(missing_ok=True); TMP.rename(IDENTITY)
 log('done ->', IDENTITY); print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == '__main__':
 main()
