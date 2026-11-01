"""Build output/linked-data/analytics.sqlite3: dashboard aggregates and dataset-wide risk indicators.

Reads the procurement database read-only. One worker per contract year writes a staging file; the
main process merges them with SQL, then adds bid-based indicators (single bidder, co-bidding pairs).
Run from the Web App folder:  python pipeline/build_analytics.py
"""
import hashlib, json, re, sqlite3, sys, time, zlib
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from itertools import combinations
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from services.namekey import v1  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'output' / 'linked-data'
IDENTITY = DATA / 'identity.sqlite3'   # optional: written by pipeline/relink_identity.py
SRC = DATA / 'procurement.sqlite3'
OUT = DATA / 'analytics.sqlite3'
TMP = DATA / 'analytics-build'
SPECIFIC = 'เฉพาะเจาะจง'
COBID_MIN_SHARED = 5       # a pair must meet in at least this many projects to be stored
COBID_MIN_PROJECTS = 5     # bidders seen in fewer projects are ignored when forming pairs
MAX_BIDDERS_FOR_PAIRS = 15 # very large tenders add noise, not signal


def ro():
 c = sqlite3.connect(SRC.as_uri() + '?mode=ro', uri=True, timeout=60); c.execute('PRAGMA cache_size=-200000'); return c

def winner_key(cid, name_key):
 """Identity used to group a contract's winner. Masked personal IDs (nine digits + xxxx) are never unmasked:
 the visible digits are hashed and combined with the name, so two people with the same name stay apart."""
 if re.fullmatch(r'\d{13}', cid): return cid
 m = re.fullmatch(r'(\d{9})x{4}', cid, re.I)
 if m: return 'masked:' + hashlib.sha256(m.group(1).encode()).hexdigest()[:10] + ':' + (name_key or '')
 return 'name:' + (name_key or '')


def ambiguous_agencies():
 """v1 keys of sub-agency names used under several parent agencies (see relink_identity.py)."""
 if not IDENTITY.exists(): return set()
 c = sqlite3.connect(IDENTITY.as_uri() + '?mode=ro', uri=True)
 try: return {r[0] for r in c.execute('SELECT sub_key FROM agency_ambiguous')}
 finally: c.close()


def agency_key(sub, parent, ambiguous):
 """Whitespace-collapsed sub-agency name; qualified by the parent when several parents share the name."""
 sub = re.sub(r'\s+', ' ', sub).strip(); parent = re.sub(r'\s+', ' ', parent or '').strip()
 return f'{sub} ({parent})' if parent and v1(sub) in ambiguous and v1(parent) != v1(sub) else sub


def money(v):
 try: return float(str(v).replace(',', '').strip() or 0)
 except ValueError: return 0.0

def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)


def contract_year(year):
 """Aggregate one fiscal-year file set. Exact duplicate rows (same content hash) are counted once."""
 c = ro(); ambiguous = ambiguous_agencies()
 registered = {r[0] for r in c.execute('SELECT cid FROM companies')}
 sources = [r[0] for r in c.execute("SELECT id FROM sources WHERE kind='contract' AND year=?", (year,))]
 seen = set(); rows = unique = linked = specific = 0; amount = 0.0
 method = defaultdict(lambda: [0, 0.0]); province = defaultdict(lambda: [0, 0.0])
 agency = {}; agency_winner = defaultdict(lambda: [0, 0.0]); company = {}
 for sid in sources:
  for cid, winner_key_col, ag, h, raw in c.execute('SELECT cid,winner_key,agency,hash,raw FROM contracts WHERE source=?', (sid,)):
   rows += 1
   if h in seen: continue
   seen.add(h); unique += 1
   r = json.loads(zlib.decompress(raw))
   amt = money(r.get('วงเงินงบประมาณในสัญญา (บาท)')); budget = money(r.get('วงเงินงบประมาณ (บาท)'))
   m = (r.get('ชื่อวิธีการจัดซื้อจัดจ้าง') or 'ไม่ระบุ').strip(); is_specific = SPECIFIC in m
   ag = agency_key((ag or r.get('ชื่อหน่วยงานย่อย') or r.get('ชื่อหน่วยงาน') or 'ไม่ระบุหน่วยงาน'), r.get('ชื่อหน่วยงาน'), ambiguous)
   cid = (cid or '').strip(); is_reg = cid in registered
   winner = winner_key(cid, winner_key_col)
   amount += amt; linked += is_reg; specific += is_specific
   method[m][0] += 1; method[m][1] += amt
   p = province[(r.get('จังหวัด') or 'ไม่ระบุ').strip()]; p[0] += 1; p[1] += amt
   a = agency.get(ag)
   if a is None: a = agency[ag] = [(r.get('ชื่อหน่วยงาน') or '').strip(), 0, 0.0, 0, 0, 0]
   a[1] += 1; a[2] += amt; a[3] += is_specific
   if budget >= 100000: a[5] += 1; a[4] += amt >= budget * 0.99
   aw = agency_winner[(ag, winner)]; aw[0] += 1; aw[1] += amt
   co = company.get(winner)
   if co is None: co = company[winner] = [(r.get('ชื่อผู้ชนะการเสนอราคา') or '').strip(), 0, 0.0, is_reg]
   co[1] += 1; co[2] += amt
 stage = TMP / f'contracts-{year}.sqlite3'
 stage.unlink(missing_ok=True)
 s = sqlite3.connect(stage)
 s.executescript('''CREATE TABLE ov(year,rows,unique_rows,amount,linked_rows,specific_rows);
  CREATE TABLE method(year,method,n,amount); CREATE TABLE province(year,province,n,amount);
  CREATE TABLE agency(year,agency,dept,n,amount,specific,near_budget,budget_n);
  CREATE TABLE agency_winner(year,agency,winner,n,amount); CREATE TABLE company(year,winner,name,n,amount,registered);''')
 s.execute('INSERT INTO ov VALUES(?,?,?,?,?,?)', (year, rows, unique, amount, linked, specific))
 s.executemany('INSERT INTO method VALUES(?,?,?,?)', ((year, k, *v) for k, v in method.items()))
 s.executemany('INSERT INTO province VALUES(?,?,?,?)', ((year, k, *v) for k, v in province.items()))
 s.executemany('INSERT INTO agency VALUES(?,?,?,?,?,?,?,?)', ((year, k, *v) for k, v in agency.items()))
 s.executemany('INSERT INTO agency_winner VALUES(?,?,?,?,?)', ((year, a, w, *v) for (a, w), v in agency_winner.items()))
 s.executemany('INSERT INTO company VALUES(?,?,?,?,?,?)', ((year, k, *v) for k, v in company.items()))
 s.commit(); s.close()
 return year, rows, unique


def bid_indicators():
 """Single-bidder projects per agency and repeated co-bidding pairs (2569 holds 99.9 % of bid rows)."""
 c = ro()
 sql = ('SELECT b.pid,b.name_key,b.name,b.linked_cid,t.agency,t.winner_key FROM bids b LEFT JOIN projects p ON p.pid=b.pid '
        'LEFT JOIN contracts t ON t.id=p.contract_row ORDER BY b.pid')
 def projects():
  cur, names, cids, ag, win = None, set(), {}, None, None
  for pid, nk, label, cid, a, w in c.execute(sql):
   if pid != cur:
    if cur is not None: yield cur, names, cids, ag, win
    cur, names, cids, ag, win = pid, set(), {}, a, w
   if nk: names.add(nk)
   year_rows[pid[:2]] += 1
   if nk and nk not in display and freq.get(nk, 0) >= COBID_MIN_PROJECTS: display[nk] = label
   if nk and cid: cids[nk] = cid
  if cur is not None: yield cur, names, cids, ag, win
 freq, display, year_rows = Counter(), {}, Counter()  # display: one published spelling per frequent bidder name
 for _, names, *_ in projects(): freq.update(names)
 coverage = dict(year_rows); year_rows.clear()  # bid rows by project year prefix (65, 66, ... = fiscal year); pass 1 counted them once
 log('bids: pass 1 done,', len(freq), 'distinct bidder names')
 single = defaultdict(lambda: [0, 0]); pairs = defaultdict(lambda: [0, 0, 0]); name_cid = defaultdict(Counter)
 for pid, names, cids, ag, win in projects():
  s = single[(ag or 'ไม่พบข้อมูลสัญญา').strip()]; s[1] += 1; s[0] += len(names) == 1
  for nk, cid in cids.items(): name_cid[nk][cid] += 1
  keep = sorted(n for n in names if freq[n] >= COBID_MIN_PROJECTS)
  if 2 <= len(keep) <= MAX_BIDDERS_FOR_PAIRS:
   for a, b in combinations(keep, 2):
    v = pairs[(a, b)]; v[0] += 1; v[1] += a == win; v[2] += b == win
 log('bids: pass 2 done,', len(pairs), 'candidate pairs')
 strong = {k: v for k, v in pairs.items() if v[0] >= COBID_MIN_SHARED}
 best_cid = {nk: cnt.most_common(1)[0][0] for nk, cnt in name_cid.items()}
 people = defaultdict(set)
 for cid, key in c.execute("SELECT r.cid,r.entity_key FROM registry_roles r JOIN companies co ON co.cid=r.cid AND co.latest_obs=r.obs WHERE r.entity_key LIKE 'person:%'"):
  people[cid].add(key)
 names = {nk: display.get(nk, nk) for pair in strong for nk in pair}
 rows = []
 for (a, b), (shared, aw, bw) in strong.items():
  ca, cb = best_cid.get(a), best_cid.get(b)
  common = sorted(people.get(ca, set()) & people.get(cb, set())) if ca and cb else []
  rows.append((a, b, names[a], names[b], ca, cb, shared, aw, bw, len(common), json.dumps(common[:10])))
 return [(k, v[0], v[1]) for k, v in single.items()], rows, coverage


def main():
 TMP.mkdir(exist_ok=True)
 started = time.time()
 years = [r[0] for r in ro().execute("SELECT DISTINCT year FROM sources WHERE kind='contract' ORDER BY year")]
 log('contract years', years)
 # Two workers: one contract year at a time plus the bid pass, to keep memory use modest.
 with ProcessPoolExecutor(max_workers=2) as pool:
  bid_job = pool.submit(bid_indicators)
  # Resume: a staging file is only written once its year is complete.
  todo = [y for y in years if not (TMP / f'contracts-{y}.sqlite3').exists()]
  log('contract years to build', todo)
  for year, rows, unique in pool.map(contract_year, todo):
   log(f'contracts {year}: {rows:,} rows, {unique:,} unique')
  single, cobid, bid_years = bid_job.result()
 tmp_out = OUT.with_suffix('.building')
 tmp_out.unlink(missing_ok=True)
 a = sqlite3.connect(tmp_out)
 a.executescript('''
 CREATE TABLE overview_year(year INTEGER PRIMARY KEY,rows INTEGER,unique_rows INTEGER,amount REAL,linked_rows INTEGER,specific_rows INTEGER);
 CREATE TABLE method_year(year INTEGER,method TEXT,n INTEGER,amount REAL);
 CREATE TABLE province_year(year INTEGER,province TEXT,n INTEGER,amount REAL);
 CREATE TABLE agency_year(year INTEGER,agency TEXT,dept TEXT,n INTEGER,amount REAL,specific INTEGER,near_budget INTEGER,budget_n INTEGER);
 CREATE TABLE company_year(year INTEGER,winner TEXT,name TEXT,n INTEGER,amount REAL,registered INTEGER);
 CREATE TABLE agency_winner(agency TEXT,winner TEXT,n INTEGER,amount REAL,years TEXT);
 CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);''')
 for y in years:
  a.execute('ATTACH DATABASE ? AS s', (str(TMP / f'contracts-{y}.sqlite3'),))
  a.execute('INSERT INTO overview_year SELECT * FROM s.ov'); a.execute('INSERT INTO method_year SELECT * FROM s.method')
  a.execute('INSERT INTO province_year SELECT * FROM s.province'); a.execute('INSERT INTO agency_year SELECT * FROM s.agency')
  a.execute('INSERT INTO company_year SELECT * FROM s.company')
  a.execute('CREATE TEMP TABLE IF NOT EXISTS aw_all(year,agency,winner,n,amount)'); a.execute('INSERT INTO temp.aw_all SELECT * FROM s.agency_winner')
  a.commit(); a.execute('DETACH DATABASE s')
 log('merging agency-winner pairs')
 a.execute("INSERT INTO agency_winner SELECT agency,winner,SUM(n),SUM(amount),group_concat(year) FROM temp.aw_all GROUP BY agency,winner")
 a.execute('DROP TABLE temp.aw_all')
 a.executescript('''
 CREATE INDEX idx_aw_agency ON agency_winner(agency,amount DESC);
 CREATE INDEX idx_aw_winner ON agency_winner(winner,amount DESC);
 CREATE INDEX idx_ay_agency ON agency_year(agency); CREATE INDEX idx_cy_winner ON company_year(winner);
 CREATE TABLE single_bid(agency TEXT PRIMARY KEY,single INTEGER,projects INTEGER);
 CREATE TABLE cobid_pairs(a TEXT,b TEXT,a_name TEXT,b_name TEXT,a_cid TEXT,b_cid TEXT,shared INTEGER,a_wins INTEGER,b_wins INTEGER,shared_people INTEGER,people TEXT);''')
 a.executemany('INSERT INTO single_bid VALUES(?,?,?)', single)
 a.executemany('INSERT INTO cobid_pairs VALUES(?,?,?,?,?,?,?,?,?,?,?)', cobid)
 log('computing agency and company statistics')
 # Concentration: HHI over supplier shares of contract value; top supplier share; method and pricing ratios.
 a.executescript('''
 CREATE TABLE agency_stats AS
  WITH tot AS (SELECT agency,MAX(dept) dept,SUM(n) n,SUM(amount) amount,SUM(specific) specific,SUM(near_budget) near_budget,SUM(budget_n) budget_n,COUNT(DISTINCT year) years FROM agency_year GROUP BY agency),
  conc AS (SELECT w.agency,COUNT(*) winners,SUM((w.amount/t.amount)*(w.amount/t.amount)) hhi,MAX(w.amount)/t.amount top_share
           FROM agency_winner w JOIN tot t ON t.agency=w.agency WHERE t.amount>0 GROUP BY w.agency)
  SELECT t.agency,t.dept,t.n,t.amount,t.years,c.winners,c.hhi,c.top_share,
   (SELECT winner FROM agency_winner x WHERE x.agency=t.agency ORDER BY amount DESC LIMIT 1) top_winner,
   1.0*t.specific/t.n specific_share,CASE WHEN t.budget_n>0 THEN 1.0*t.near_budget/t.budget_n END near_budget_share,
   s.single,s.projects bid_projects,CASE WHEN s.projects>0 THEN 1.0*s.single/s.projects END single_bid_rate
  FROM tot t LEFT JOIN conc c ON c.agency=t.agency LEFT JOIN single_bid s ON s.agency=t.agency;
 CREATE UNIQUE INDEX idx_as_agency ON agency_stats(agency);
 CREATE INDEX idx_as_hhi ON agency_stats(n,hhi);
 CREATE TABLE company_stats AS
  SELECT winner,MAX(name) name,MAX(registered) registered,SUM(n) n,SUM(amount) amount,COUNT(DISTINCT year) years,
   (SELECT COUNT(*) FROM agency_winner w WHERE w.winner=c.winner) agencies FROM company_year c GROUP BY winner;
 CREATE UNIQUE INDEX idx_cs_winner ON company_stats(winner);
 CREATE INDEX idx_cs_amount ON company_stats(amount DESC);
 CREATE INDEX idx_cp_a ON cobid_pairs(a_cid); CREATE INDEX idx_cp_b ON cobid_pairs(b_cid);
 CREATE INDEX idx_cp_shared ON cobid_pairs(shared_people DESC,shared DESC);''')
 a.executemany('INSERT INTO meta VALUES(?,?)', [('built_at', time.strftime('%Y-%m-%dT%H:%M:%S%z')),
  ('source_db_mtime', str(SRC.stat().st_mtime)), ('build_seconds', str(round(time.time() - started))),
  ('cobid_min_shared', str(COBID_MIN_SHARED)), ('cobid_min_projects', str(COBID_MIN_PROJECTS)),
  ('bid_rows_by_project_year', json.dumps({'25' + k: v for k, v in sorted(bid_years.items())})),
  ('identity_file_used', str(IDENTITY.exists()))])
 a.commit(); a.execute('VACUUM'); a.close()
 tmp_out.replace(OUT)
 for f in TMP.glob('*.sqlite3'): f.unlink()
 TMP.rmdir()
 log(f'done in {time.time() - started:.0f}s -> {OUT}')


if __name__ == '__main__':
 sys.exit(main())
