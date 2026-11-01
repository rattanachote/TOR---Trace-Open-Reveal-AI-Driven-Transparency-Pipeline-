"""API integration tests against a real server process and the real procurement data.

Uses a separate account database ``tor_test`` in the tor-auth-db container, wiped at the start, so the
real accounts are never touched. Skips when Docker or the procurement database is unavailable.
Run from the Web App folder:  python -m unittest discover -s tests -p "test_api.py" -v
"""
import http.cookiejar, json, os, socket, sqlite3, subprocess, sys, time, unittest, urllib.error, urllib.parse, urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DB = APP.parent / 'output' / 'linked-data' / 'procurement.sqlite3'
ADMIN_PW, NEW_PW = 'Test-Admin-111', 'Test-Admin-222'


def psql(sql, db='tor'):
 return subprocess.run(['docker', 'exec', 'tor-auth-db', 'psql', '-U', 'tor', '-d', db, '-q', '-c', sql], capture_output=True, text=True, timeout=30)


class Client:
 def __init__(self, base):
  self.base = base; self.jar = http.cookiejar.CookieJar()
  self.open = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar)).open

 def call(self, path, body=None, headers=None, **query):
  url = self.base + path + ('?' + urllib.parse.urlencode(query) if query else '')
  data = json.dumps(body).encode() if body is not None else None
  req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json', **(headers or {})} if data else (headers or {}))
  try:
   with self.open(req, timeout=120) as r: raw = r.read(); return r.status, (json.loads(raw) if 'json' in r.headers.get('Content-Type', '') else raw), r.headers
  except urllib.error.HTTPError as e:
   raw = e.read(); return e.code, (json.loads(raw) if raw.startswith(b'{') else raw), e.headers


class Api(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  if not DB.exists(): raise unittest.SkipTest('procurement database not found')
  try:
   if psql('SELECT 1').returncode: raise unittest.SkipTest('tor-auth-db container not running')
  except FileNotFoundError: raise unittest.SkipTest('docker not installed')
  if 'tor_test' not in psql("SELECT datname FROM pg_database WHERE datname='tor_test'").stdout + subprocess.run(
     ['docker', 'exec', 'tor-auth-db', 'psql', '-U', 'tor', '-d', 'tor', '-tAc', "SELECT datname FROM pg_database WHERE datname='tor_test'"], capture_output=True, text=True).stdout:
   psql('CREATE DATABASE tor_test')
  psql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;', db='tor_test')
  with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
  env = {**os.environ, 'TOR_PG_DB': 'tor_test', 'TOR_ADMIN_USER': 'admin', 'TOR_ADMIN_PASSWORD': ADMIN_PW, 'PYTHONIOENCODING': 'utf-8'}
  cls.proc = subprocess.Popen([sys.executable, str(APP / 'backend' / 'server.py'), '--port', str(port)], env=env, cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
  cls.base = f'http://127.0.0.1:{port}'
  for _ in range(60):
   try: urllib.request.urlopen(cls.base + '/api/health', timeout=2); break
   except Exception: time.sleep(0.5)
  else: raise RuntimeError('server did not start: ' + cls.proc.stdout.read(2000).decode(errors='replace'))

 @classmethod
 def tearDownClass(cls):
  if getattr(cls, 'proc', None): cls.proc.terminate(); cls.proc.wait(10)

 def admin(self):
  c = Client(self.base)
  status, body, _ = c.call('/api/auth/login', {'username': 'admin', 'password': NEW_PW})
  if status == 401:
   self.assertEqual(c.call('/api/auth/login', {'username': 'admin', 'password': ADMIN_PW})[0], 200)
   self.assertEqual(c.call('/api/auth/password', {'current': ADMIN_PW, 'new': NEW_PW})[0], 200)
  return c

 def user(self, name):
  c = Client(self.base)
  status, body, _ = c.call('/api/auth/register', {'username': name, 'name': 'ผู้ทดสอบ ' + name, 'password': 'user-pass-123'})
  self.assertEqual(status, 200, body); return c

 # ─── tests run in name order ───
 def test_01_anonymous(self):
  c = Client(self.base)
  self.assertEqual(c.call('/api/companies', limit=1)[0], 401)
  self.assertEqual(c.call('/api/health')[0], 200)
  self.assertEqual(c.call('/api/public/cases')[0], 200)
  self.assertEqual(c.call('/assets/')[0], 404, 'directory listing must be off')
  _, _, headers = c.call('/')
  self.assertEqual(headers['X-Frame-Options'], 'DENY'); self.assertIn("default-src 'self'", headers['Content-Security-Policy'])
  self.assertNotIn('Python', headers['Server'])

 def test_02_bootstrap_admin_must_change_password(self):
  c = Client(self.base)
  status, body, _ = c.call('/api/auth/login', {'username': 'admin', 'password': ADMIN_PW})
  if status == 401: self.skipTest('password already changed by another test')
  self.assertTrue(body['user']['must_change'])
  self.assertEqual(c.call('/api/companies', limit=1)[0], 403)
  self.assertEqual(c.call('/api/auth/password', {'current': ADMIN_PW, 'new': ADMIN_PW})[0], 400, 'new password must differ')
  self.assertEqual(c.call('/api/auth/password', {'current': ADMIN_PW, 'new': NEW_PW})[0], 200)
  self.assertEqual(c.call('/api/companies', limit=1)[0], 200)

 def test_03_user_can_view_but_not_confirm(self):
  u = self.user('viewer1')
  self.assertEqual(u.call('/api/companies', limit=1)[0], 200)
  self.assertEqual(u.call('/api/reviews', {'key': 'a|b|c', 'status': 'ok'})[0], 403)
  self.assertEqual(u.call('/api/admin/users')[0], 403)
  self.assertEqual(u.call('/api/cases', scope='queue')[0], 403)

 def test_04_name_search_ignores_spacing(self):
  u = self.user('viewer2')
  for q in ('ยงยุทธ ปวิตรปก', 'นาย ยงยุทธ  ปวิตรปก', 'นายยงยุทธ ปวิตรปก'):
   status, body, _ = u.call('/api/people', q=q, limit=5)
   self.assertEqual(status, 200); self.assertGreater(len(body['items']), 0, q)

 def test_05_login_throttle_is_per_ip_and_username(self):
  c = Client(self.base)
  for _ in range(8): c.call('/api/auth/login', {'username': 'nobody', 'password': 'wrong-password'})
  self.assertEqual(c.call('/api/auth/login', {'username': 'nobody', 'password': 'wrong-password'})[0], 429)
  self.admin()  # a different username from the same IP still signs in

 def test_06_publish_workflow(self):
  u, a = self.user('author1'), self.admin()
  spec = {'kind': 'company', 'key': '0102504000650', 'depth': 1, 'branch': 6, 'expanded': []}
  status, case, _ = u.call('/api/cases/save', {'title': 'เรื่องทดสอบ', 'summary': 'ทดสอบการเผยแพร่', 'spec': spec})
  self.assertEqual(status, 200, case)
  self.assertEqual(u.call('/api/cases/submit', {'id': case['id']})[0], 200)
  self.assertEqual(u.call('/api/cases/publish', {'id': case['id']})[0], 403, 'users cannot publish')
  status, prev, _ = a.call('/api/cases/preview', {'id': case['id']}); self.assertEqual(status, 200, prev)
  status, pub, _ = a.call('/api/cases/publish', {'id': case['id']}); self.assertEqual(status, 200, pub)
  slug = pub['slug']
  status, snap, _ = Client(self.base).call('/api/public/case', slug=slug); self.assertEqual(status, 200)
  for e in snap['edges']:
   self.assertTrue(e.get('confidence') in (None, 'high') or (e.get('review') or {}).get('status') == 'ok', e)
  cited = next(e['evidence'] for e in snap['edges'] if isinstance(e.get('evidence'), dict))
  anon = Client(self.base)
  self.assertEqual(anon.call('/api/public/evidence/row', slug=slug, archive=cited['archive'], member=cited['member'], seq=cited['sequence'], format='json')[0], 200)
  self.assertEqual(anon.call('/api/public/evidence/row', slug=slug, archive=cited['archive'], member=cited['member'], seq='1', format='json')[0], 403, 'only cited rows')
  status, corr, _ = anon.call('/api/public/corrections', {'slug': slug, 'name': 'ประชาชน', 'contact': 'a@example.com', 'message': 'ข้อมูลไม่ตรงกับทะเบียน กรุณาตรวจสอบ'})
  self.assertEqual(status, 200, corr)
  status, lst, _ = a.call('/api/corrections'); self.assertIn(corr['id'], [k['id'] for k in lst['items']])
  self.assertEqual(a.call('/api/cases/withdraw', {'id': case['id'], 'note': 'ทดสอบถอน'})[0], 200)
  self.assertEqual(Client(self.base).call('/api/public/case', slug=slug)[0], 404)

 def test_07_reviewer_role_exists(self):
  status, body, _ = self.admin().call('/api/admin/roles')
  roles = {r['name']: r for r in body['roles']}
  self.assertEqual(set(roles['reviewer']['permissions']), {'data.view', 'data.export', 'review.confirm'})

 # ─── second linking pass (needs identity.sqlite3 built by pipeline/relink_identity.py) ───
 def identity_db(self):
  path = APP.parent / 'output' / 'linked-data' / 'identity.sqlite3'
  if not path.exists(): self.skipTest('identity.sqlite3 not built')
  return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)

 def test_08_same_name_queue_and_graph(self):
  idn = self.identity_db(); u, a = self.user('viewer3'), self.admin()
  status, body, _ = u.call('/api/review/same-name', limit=40); self.assertEqual(status, 200)
  self.assertTrue(body['items'] and all(len(g['members']) >= 2 for g in body['items']))
  # a group whose two companies sit in the DBD registry and whose roles fit within the branch limit
  group = next(g for g in body['items'] if len({m['cid'] for m in g['members']}) >= 2)
  gid, first, second = group['gid'], group['members'][0], group['members'][1]
  self.assertEqual(u.call('/api/reviews', {'key': 'samename|' + gid, 'status': 'ok'})[0], 403, 'viewers cannot decide')
  def person_nodes(): 
   status, graph, _ = a.call('/api/entity-graph', kind='company', key=first['cid'], limit=48, depth=2); self.assertEqual(status, 200, graph)
   return graph, [n for n in graph['nodes'] if n['id'] == 'person:samename:' + gid]
  graph, found = person_nodes(); self.assertEqual(found, [], 'unconfirmed names are never merged')
  self.assertEqual(a.call('/api/reviews', {'key': 'samename|' + gid, 'status': 'no'})[0], 200)
  self.assertEqual(person_nodes()[1], [], 'a rejected group never joins')
  self.assertEqual(a.call('/api/reviews', {'key': 'samename|' + gid, 'status': 'ok'})[0], 200)
  graph, found = person_nodes(); self.assertEqual(len(found), 1); self.assertEqual(found[0]['identity_status'], 'confirmed_same_person')
  companies = {e['target'] for e in graph['edges'] if e['source'] == found[0]['id'] and e['type'] == 'REPORTED_RELATED_PARTY'}
  self.assertGreaterEqual(len(companies), 2, 'one person node now connects both companies')
  self.assertEqual(a.call('/api/reviews', {'key': 'samename|' + gid, 'status': None})[0], 200)
  idn.close()

 def test_09_extra_bidder_links_are_low_confidence(self):
  idn = self.identity_db(); a = self.admin()
  bid_id = idn.execute("SELECT bid_id FROM bid_links_v2 WHERE method='contract_name_unique_unverified' LIMIT 1").fetchone()[0]
  main = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True); pid = main.execute('SELECT pid FROM bids WHERE id=?', (bid_id,)).fetchone()[0]; main.close()
  status, graph, _ = a.call('/api/entity-graph', kind='project', key=pid, limit=48, depth=1); self.assertEqual(status, 200)
  extra = [e for e in graph['edges'] if str(e.get('link_method', '')).startswith('contract_name_')]
  self.assertTrue(extra, 'the project shows the added link'); self.assertTrue(all(e['confidence'] == 'low' for e in extra))
  idn.close()

 def test_10_shared_agency_name_is_told_apart(self):
  idn = self.identity_db(); a = self.admin()
  sub = idn.execute('SELECT sub FROM agency_ambiguous ORDER BY rows DESC LIMIT 1').fetchone()[0]
  main = sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True)
  import json as _json, zlib
  parents = {}
  for pid, raw in main.execute('SELECT pid,raw FROM contracts WHERE agency=? LIMIT 4000', (sub,)):
   parents.setdefault(_json.loads(zlib.decompress(raw)).get('ชื่อหน่วยงาน'), pid)
  main.close(); self.assertTrue(parents)
  parent, pid = next(iter(parents.items()))
  status, graph, _ = a.call('/api/entity-graph', kind='project', key=pid, limit=12, depth=1); self.assertEqual(status, 200)
  labels = [n['label'] for n in graph['nodes'] if n['type'] == 'Agency']
  self.assertIn(f'{sub} ({parent})', labels)
  status, opened, _ = a.call('/api/entity-graph', kind='agency', key=f'{sub}||{parent}', limit=8, depth=1); self.assertEqual(status, 200, opened)
  self.assertEqual(opened['short'], f'{sub} ({parent})'); self.assertTrue(any(e['type'] == 'PROCURES' for e in opened['edges']))
  idn.close()


if __name__ == '__main__':
 unittest.main()
