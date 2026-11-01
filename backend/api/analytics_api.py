"""Dashboard aggregates and dataset-wide risk indicators (reads output/linked-data/analytics.sqlite3)."""
import re, sqlite3

from api.routes import get
from config import ANALYTICS
from services.accounts import AuthError

MIN_CONTRACTS = 50   # agencies with fewer contracts are not ranked: ratios on tiny samples mislead


def adb():
 if not ANALYTICS.exists():
  raise AuthError(503, 'ยังไม่ได้สร้างข้อมูลภาพรวม — รัน python pipeline/build_analytics.py')
 c = sqlite3.connect(ANALYTICS.as_uri() + '?mode=ro', uri=True, timeout=30); c.row_factory = sqlite3.Row
 return c

def dicts(cur): return [dict(r) for r in cur]

def built_at(c): return dict(c.execute('SELECT key,value FROM meta'))


@get('/api/dashboard/overview', 'data.view')
def overview(h, q):
 with adb() as c:
  return h.send_json({
   'meta': built_at(c),
   'years': dicts(c.execute('SELECT * FROM overview_year ORDER BY year')),
   'methods': dicts(c.execute('SELECT method,SUM(n) n,SUM(amount) amount FROM method_year GROUP BY method ORDER BY n DESC LIMIT 8')),
   'provinces': dicts(c.execute("SELECT province,SUM(n) n,SUM(amount) amount FROM province_year WHERE province<>'ไม่ระบุ' GROUP BY province ORDER BY amount DESC LIMIT 15")),
   'agencies': dicts(c.execute('SELECT agency,dept,n,amount,hhi,top_share,specific_share FROM agency_stats ORDER BY amount DESC LIMIT 12')),
   'companies': dicts(c.execute('SELECT winner,name,registered,n,amount,agencies FROM company_stats ORDER BY amount DESC LIMIT 12')),
  })


def percentile(c, column, value):
 if value is None: return None
 total = c.execute(f'SELECT COUNT(*) FROM agency_stats WHERE n>=? AND {column} IS NOT NULL', (MIN_CONTRACTS,)).fetchone()[0]
 lower = c.execute(f'SELECT COUNT(*) FROM agency_stats WHERE n>=? AND {column}<?', (MIN_CONTRACTS, value)).fetchone()[0]
 return round(100 * lower / total) if total else None


def resolve_agency(c, name):
 """Exact key first, then with whitespace collapsed, then units that share this name and carry their parent in
 brackets ('คณะวิทยาศาสตร์ (มหาวิทยาลัยขอนแก่น)'). Returns (row, other units with the same name)."""
 name = re.sub(r'\s+', ' ', name or '').strip()
 if '||' in name: sub, _, parent = name.partition('||'); name = f'{sub} ({parent})'  # graph key of a unit that shares its name
 row = c.execute('SELECT * FROM agency_stats WHERE agency=?', (name,)).fetchone()
 if row: return row, []
 like = name.replace('!', '!!').replace('%', '!%').replace('_', '!_') + ' (%'
 rows = c.execute("SELECT * FROM agency_stats WHERE agency LIKE ? ESCAPE '!' ORDER BY n DESC LIMIT 25", (like,)).fetchall()
 return (rows[0], [{'agency': r['agency'], 'dept': r['dept'], 'n': r['n']} for r in rows]) if rows else (None, [])


@get('/api/dashboard/agency', 'data.view')
def agency(h, q):
 with adb() as c:
  row, same_name = resolve_agency(c, q('name'))
  if not row: raise AuthError(404, 'ไม่พบหน่วยงานนี้ในข้อมูลภาพรวม')
  stats = dict(row); name = stats['agency']
  ranks = {k: percentile(c, k, stats[k]) for k in ('hhi', 'top_share', 'specific_share', 'near_budget_share', 'single_bid_rate')} if stats['n'] >= MIN_CONTRACTS else {}
  return h.send_json({
   'meta': built_at(c), 'stats': stats, 'percentile': ranks, 'min_contracts': MIN_CONTRACTS, 'same_name': same_name,
   'years': dicts(c.execute('SELECT year,n,amount,specific FROM agency_year WHERE agency=? ORDER BY year', (name,))),
   'winners': dicts(c.execute('SELECT w.winner,s.name,s.registered,w.n,w.amount,w.years FROM agency_winner w LEFT JOIN company_stats s ON s.winner=w.winner '
                              'WHERE w.agency=? ORDER BY w.amount DESC LIMIT 10', (name,))),
  })


@get('/api/dashboard/company', 'data.view')
def company(h, q):
 key = q('cid')
 with adb() as c:
  row = c.execute('SELECT * FROM company_stats WHERE winner=?', (key,)).fetchone()
  if not row: raise AuthError(404, 'ไม่พบผู้รับจ้างนี้ในข้อมูลภาพรวม')
  return h.send_json({
   'meta': built_at(c), 'stats': dict(row),
   'years': dicts(c.execute('SELECT year,n,amount FROM company_year WHERE winner=? ORDER BY year', (key,))),
   'agencies': dicts(c.execute('SELECT agency,n,amount,years FROM agency_winner WHERE winner=? ORDER BY amount DESC LIMIT 10', (key,))),
   'cobid': dicts(c.execute('SELECT * FROM cobid_pairs WHERE a_cid=? OR b_cid=? ORDER BY shared_people DESC,shared DESC LIMIT 15', (key, key))),
  })


INDICATORS = {
 'concentration': ('SELECT agency,dept,n,amount,winners,hhi,top_share,top_winner,(SELECT name FROM company_stats WHERE winner=top_winner) top_name '
                   'FROM agency_stats WHERE n>=? ORDER BY hhi DESC LIMIT ?'),
 'specific': 'SELECT agency,dept,n,amount,specific_share FROM agency_stats WHERE n>=? ORDER BY specific_share DESC,n DESC LIMIT ?',
 'near_budget': 'SELECT agency,dept,n,amount,near_budget_share FROM agency_stats WHERE n>=? AND near_budget_share IS NOT NULL ORDER BY near_budget_share DESC,n DESC LIMIT ?',
 'single_bid': ('SELECT agency,dept,n,amount,single,bid_projects,single_bid_rate FROM agency_stats '
                'WHERE bid_projects>=? ORDER BY single_bid_rate DESC,bid_projects DESC LIMIT ?'),
 'cobid': 'SELECT * FROM cobid_pairs WHERE shared>=? ORDER BY shared_people DESC,shared DESC LIMIT ?',
}

@get('/api/indicators', 'data.view')
def indicators(h, q):
 kind = q('type', 'concentration')
 if kind not in INDICATORS: raise AuthError(400, 'ประเภทตัวชี้วัดไม่ถูกต้อง')
 minimum = max(1, min(100000, int(q('min', '5' if kind == 'cobid' else str(MIN_CONTRACTS)))))
 limit = max(1, min(200, int(q('limit', '50'))))
 with adb() as c:
  return h.send_json({'meta': built_at(c), 'type': kind, 'min': minimum, 'items': dicts(c.execute(INDICATORS[kind], (minimum, limit)))})
