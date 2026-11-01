"""Accounts, roles, sessions, review decisions and an audit trail.

Stored in PostgreSQL (docker compose service ``auth-db``); the procurement data itself stays in
the read-only SQLite file. Passwords use scrypt, sessions are random tokens kept only as SHA-256.
"""
import hashlib, hmac, json, os, queue, re, secrets, threading, time
from contextlib import contextmanager

import config  # noqa: F401  (puts Web App/vendor on sys.path)
import pg8000.native  # pure-Python driver vendored in Web App/vendor

PERMISSIONS = {
 'data.view': 'ดูข้อมูล รายละเอียด แผนผัง และหลักฐาน',
 'data.export': 'ส่งออกภาพแผนผังและข้อมูล JSON',
 'review.confirm': 'ยืนยันหรือปฏิเสธข้อมูลก่อนเผยแพร่',
 'users.manage': 'สร้างและจัดการผู้ใช้',
 'roles.manage': 'สร้างและจัดการบทบาทและสิทธิ์',
}
BUILTIN_ROLES = {
 'admin': ('ผู้ดูแลระบบ', list(PERMISSIONS)),
 'reviewer': ('ผู้ตรวจทาน', ['data.view', 'data.export', 'review.confirm']),
 'user': ('ผู้ใช้งาน', ['data.view', 'data.export']),
}
SESSION_DAYS = 7
USERNAME = re.compile(r'[a-z0-9_.-]{3,32}')
ROLENAME = re.compile(r'[a-z0-9_-]{2,32}')

SCHEMA = """
CREATE TABLE IF NOT EXISTS roles(
 name TEXT PRIMARY KEY, label TEXT NOT NULL, permissions TEXT[] NOT NULL DEFAULT '{}',
 builtin BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users(
 id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL REFERENCES roles(name), active BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reviews(
 edge_key TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('ok','no')), note TEXT, graph JSONB,
 reviewer_id INT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit(
 id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id INT REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL, detail JSONB);
"""


class AuthError(Exception):
 def __init__(self, status, message):
  super().__init__(message); self.status = status; self.message = message


# ───────── connection pool ─────────
_pool = queue.LifoQueue()

def _connect():
 return pg8000.native.Connection(
  user=os.environ.get('TOR_PG_USER', 'tor'), password=os.environ['TOR_PG_PASSWORD'],
  host=os.environ.get('TOR_PG_HOST', '127.0.0.1'), port=int(os.environ.get('TOR_PG_PORT', '5433')),
  database=os.environ.get('TOR_PG_DB', 'tor'), timeout=15)

@contextmanager
def conn(transaction=False):
 try: c = _pool.get_nowait()
 except queue.Empty: c = _connect()
 ok = False
 try:
  if transaction: c.run('START TRANSACTION')
  yield c
  if transaction: c.run('COMMIT')
  ok = True
 finally:
  if not ok:
   try:
    if transaction: c.run('ROLLBACK')
    ok = True
   except Exception:
    try: c.close()
    except Exception: pass
  if ok and _pool.qsize() < 8: _pool.put(c)

def rows(c, sql, **params):
 data = c.run(sql, **params)
 cols = [d['name'] for d in c.columns] if c.columns else []
 return [dict(zip(cols, r)) for r in data]


# ───────── passwords & tokens ─────────
def hash_password(password):
 salt = secrets.token_bytes(16)
 digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
 return f'scrypt$16384$8$1${salt.hex()}${digest.hex()}'

def check_password(password, stored):
 try:
  _, n, r, p, salt, digest = stored.split('$')
  test = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(digest) // 2)
  return hmac.compare_digest(test.hex(), digest)
 except (ValueError, TypeError):
  return False

_DUMMY = hash_password(secrets.token_hex(8))
token_hash = lambda token: hashlib.sha256(token.encode()).hexdigest()

def valid_password(password):
 if not isinstance(password, str) or not 8 <= len(password) <= 128:
  raise AuthError(400, 'รหัสผ่านต้องยาว 8–128 ตัวอักษร')
 return password

def valid_username(username):
 username = (username or '').strip().lower()
 if not USERNAME.fullmatch(username):
  raise AuthError(400, 'ชื่อผู้ใช้ต้องเป็น a-z 0-9 _ . - ยาว 3–32 ตัว')
 return username

def valid_name(name):
 name = re.sub(r'\s+', ' ', name or '').strip()
 if not 1 <= len(name) <= 80: raise AuthError(400, 'กรอกชื่อที่แสดง 1–80 ตัวอักษร')
 return name


# ───────── setup ─────────
def init(wait_seconds=60):
 deadline = time.monotonic() + wait_seconds
 while True:
  try:
   with conn() as c: c.run('SELECT 1')
   break
  except Exception as e:
   if time.monotonic() > deadline:
    raise RuntimeError('เชื่อมต่อฐานข้อมูลผู้ใช้ (PostgreSQL) ไม่ได้ — เปิด Docker แล้วรัน: docker compose -f docker/docker-compose.yml --env-file .env up -d') from e
   time.sleep(1.5)
 with conn(True) as c:
  c.run('SELECT pg_advisory_xact_lock(7342001)')
  for stmt in SCHEMA.split(';'):
   if stmt.strip(): c.run(stmt)
  _migrate(c)
  for name, (label, perms) in BUILTIN_ROLES.items():
   c.run('INSERT INTO roles(name,label,permissions,builtin) VALUES(:n,:l,:p,true) ON CONFLICT(name) DO NOTHING', n=name, l=label, p=perms)
  # The admin role always keeps every permission so the system cannot be locked out.
  c.run("UPDATE roles SET permissions=:p, builtin=true WHERE name='admin'", p=list(PERMISSIONS))
  if not c.run('SELECT 1 FROM users LIMIT 1'):
   user, password = os.environ.get('TOR_ADMIN_USER', 'admin'), os.environ.get('TOR_ADMIN_PASSWORD')
   if password:
    c.run("INSERT INTO users(username,name,password_hash,role,must_change) VALUES(:u,'ผู้ดูแลระบบ',:h,'admin',true)", u=valid_username(user), h=hash_password(password))
    c.run("INSERT INTO audit(action,detail) VALUES('bootstrap_admin',:d)", d=json.dumps({'username': user}))
    print(f'Created first admin account "{user}" (password from .env TOR_ADMIN_PASSWORD).', flush=True)
  c.run('DELETE FROM sessions WHERE expires_at < now()')

MIGRATIONS = [
 # Bootstrap and admin-set passwords must be changed by their owner on next sign-in.
 ('2026-10-31-must-change', [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change BOOLEAN NOT NULL DEFAULT false',
  "UPDATE users u SET must_change=true WHERE EXISTS (SELECT 1 FROM audit a WHERE a.action='bootstrap_admin' AND a.detail->>'username'=u.username) "
  "AND NOT EXISTS (SELECT 1 FROM audit a WHERE a.user_id=u.id AND a.action='change_password')",
 ]),
]

def _migrate(c):
 done = {r[0] for r in c.run('SELECT name FROM migrations')}
 for name, statements in MIGRATIONS:
  if name in done: continue
  for stmt in statements: c.run(stmt)
  c.run('INSERT INTO migrations(name) VALUES(:n)', n=name)

def audit(c, user, action, **detail):
 c.run('INSERT INTO audit(user_id,action,detail) VALUES(:u,:a,:d)', u=user and user['id'], a=action, d=json.dumps(detail, ensure_ascii=False, default=str))


# ───────── sessions ─────────
_fails, _fail_lock = {}, threading.Lock()

LIMITS = (('pair', 8), ('ip', 30))  # failures allowed per 10 minutes: same IP+username, same IP

def _throttle(ip, username):
 now = time.time()
 with _fail_lock:
  for kind, limit in LIMITS:
   key = (kind, ip, username if kind == 'pair' else '')
   recent = [t for t in _fails.get(key, []) if now - t < 600]
   _fails[key] = recent
   if len(recent) >= limit: raise AuthError(429, 'ลองเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 10 นาที')

def _failed(ip, username):
 with _fail_lock:
  for kind, _ in LIMITS: _fails.setdefault((kind, ip, username if kind == 'pair' else ''), []).append(time.time())

def _new_session(c, user_id):
 token = secrets.token_urlsafe(32)
 c.run(f"INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(:t,:u,now()+interval '{SESSION_DAYS} days')", t=token_hash(token), u=user_id)
 c.run('UPDATE users SET last_login=now() WHERE id=:u', u=user_id)
 return token

USER_SQL = ('SELECT u.id,u.username,u.name,u.role,u.active,u.must_change,u.created_at,u.last_login,r.label AS role_label,r.permissions '
            'FROM users u JOIN roles r ON r.name=u.role')

def public_user(u):
 return {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in u.items() if k != 'password_hash'}

def register(username, name, password):
 username, name, password = valid_username(username), valid_name(name), valid_password(password)
 with conn(True) as c:
  if c.run('SELECT 1 FROM users WHERE username=:u', u=username): raise AuthError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว')
  uid = c.run("INSERT INTO users(username,name,password_hash,role) VALUES(:u,:n,:h,'user') RETURNING id", u=username, n=name, h=hash_password(password))[0][0]
  audit(c, {'id': uid}, 'register', username=username)
  token = _new_session(c, uid)
  return token, rows(c, USER_SQL + ' WHERE u.id=:i', i=uid)[0]

def login(username, password, ip=''):
 key = (username or '').strip().lower(); _throttle(ip, key)
 with conn(True) as c:
  found = rows(c, 'SELECT id,password_hash,active FROM users WHERE username=:u', u=key)
  if not found or not check_password(password or '', found[0]['password_hash']):
   if not found: check_password(password or '', _DUMMY)  # same timing for unknown users
   _failed(ip, key); raise AuthError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  if not found[0]['active']: raise AuthError(403, 'บัญชีนี้ถูกระงับ ติดต่อผู้ดูแลระบบ')
  token = _new_session(c, found[0]['id'])
  audit(c, found[0], 'login')
  return token, rows(c, USER_SQL + ' WHERE u.id=:i', i=found[0]['id'])[0]

def logout(token):
 if token:
  with conn() as c: c.run('DELETE FROM sessions WHERE token_hash=:t', t=token_hash(token))

def session_user(token):
 if not token: return None
 with conn() as c:
  found = rows(c, USER_SQL + ' JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=:t AND s.expires_at>now() AND u.active', t=token_hash(token))
 return found[0] if found else None

def change_password(user, current, new):
 valid_password(new)
 with conn(True) as c:
  stored = c.run('SELECT password_hash FROM users WHERE id=:i', i=user['id'])[0][0]
  if not check_password(current or '', stored): raise AuthError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง')
  if check_password(new, stored): raise AuthError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม')
  c.run('UPDATE users SET password_hash=:h, must_change=false WHERE id=:i', h=hash_password(new), i=user['id'])
  audit(c, user, 'change_password')


# ───────── admin: users & roles ─────────
def _guard_admins(c):
 """At least one active account must still be able to manage users and roles."""
 left = c.run("SELECT count(*) FROM users u JOIN roles r ON r.name=u.role WHERE u.active "
              "AND 'users.manage'=ANY(r.permissions) AND 'roles.manage'=ANY(r.permissions)")[0][0]
 if not left: raise AuthError(400, 'ต้องมีผู้ใช้ที่จัดการผู้ใช้และบทบาทได้อย่างน้อยหนึ่งคน')

def list_users():
 with conn() as c: return [public_user(u) for u in rows(c, USER_SQL + ' ORDER BY u.created_at')]

def create_user(actor, username, name, password, role):
 username, name, password = valid_username(username), valid_name(name), valid_password(password)
 with conn(True) as c:
  if not c.run('SELECT 1 FROM roles WHERE name=:r', r=role): raise AuthError(400, 'ไม่พบบทบาทนี้')
  if c.run('SELECT 1 FROM users WHERE username=:u', u=username): raise AuthError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว')
  uid = c.run('INSERT INTO users(username,name,password_hash,role,must_change) VALUES(:u,:n,:h,:r,true) RETURNING id', u=username, n=name, h=hash_password(password), r=role)[0][0]
  audit(c, actor, 'create_user', username=username, role=role)
  return public_user(rows(c, USER_SQL + ' WHERE u.id=:i', i=uid)[0])

def update_user(actor, uid, role=None, active=None, name=None, password=None):
 with conn(True) as c:
  target = rows(c, 'SELECT id,username FROM users WHERE id=:i', i=int(uid))
  if not target: raise AuthError(404, 'ไม่พบผู้ใช้')
  changes = {}
  if role is not None:
   if not c.run('SELECT 1 FROM roles WHERE name=:r', r=role): raise AuthError(400, 'ไม่พบบทบาทนี้')
   c.run('UPDATE users SET role=:r WHERE id=:i', r=role, i=int(uid)); changes['role'] = role
  if active is not None:
   c.run('UPDATE users SET active=:a WHERE id=:i', a=bool(active), i=int(uid)); changes['active'] = bool(active)
   if not active: c.run('DELETE FROM sessions WHERE user_id=:i', i=int(uid))
  if name is not None:
   c.run('UPDATE users SET name=:n WHERE id=:i', n=valid_name(name), i=int(uid)); changes['name'] = name
  if password:
   c.run('UPDATE users SET password_hash=:h, must_change=true WHERE id=:i', h=hash_password(valid_password(password)), i=int(uid))
   c.run('DELETE FROM sessions WHERE user_id=:i', i=int(uid)); changes['password'] = 'reset'
  _guard_admins(c)
  audit(c, actor, 'update_user', username=target[0]['username'], **changes)
  return public_user(rows(c, USER_SQL + ' WHERE u.id=:i', i=int(uid))[0])

def list_roles():
 with conn() as c:
  return rows(c, 'SELECT r.name,r.label,r.permissions,r.builtin,(SELECT count(*) FROM users u WHERE u.role=r.name) AS users FROM roles r ORDER BY r.builtin DESC, r.created_at')

def save_role(actor, name, label, permissions):
 name = (name or '').strip().lower()
 if not ROLENAME.fullmatch(name): raise AuthError(400, 'ชื่อบทบาทต้องเป็น a-z 0-9 _ - ยาว 2–32 ตัว')
 label = valid_name(label)
 perms = sorted(set(permissions or []))
 if any(p not in PERMISSIONS for p in perms): raise AuthError(400, 'มีสิทธิ์ที่ไม่รู้จัก')
 with conn(True) as c:
  if name == 'admin': perms = list(PERMISSIONS)
  c.run('INSERT INTO roles(name,label,permissions) VALUES(:n,:l,:p) ON CONFLICT(name) DO UPDATE SET label=:l, permissions=:p', n=name, l=label, p=perms)
  _guard_admins(c)
  audit(c, actor, 'save_role', role=name, label=label, permissions=perms)
 return list_roles()

def delete_role(actor, name):
 with conn(True) as c:
  found = rows(c, 'SELECT builtin FROM roles WHERE name=:n', n=name)
  if not found: raise AuthError(404, 'ไม่พบบทบาท')
  if found[0]['builtin']: raise AuthError(400, 'ลบบทบาทพื้นฐานไม่ได้')
  if c.run('SELECT 1 FROM users WHERE role=:n LIMIT 1', n=name): raise AuthError(400, 'ยังมีผู้ใช้ในบทบาทนี้ ย้ายผู้ใช้ก่อนลบ')
  c.run('DELETE FROM roles WHERE name=:n', n=name)
  audit(c, actor, 'delete_role', role=name)
 return list_roles()

def audit_log(limit=150):
 with conn() as c:
  out = rows(c, 'SELECT a.id,a.at,a.action,a.detail,u.username,u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT :l', l=int(limit))
 for r in out: r['at'] = r['at'].isoformat()
 return out


# ───────── review decisions (human-in-the-loop) ─────────
def all_reviews():
 with conn() as c:
  out = rows(c, 'SELECT r.edge_key,r.status,r.note,r.graph,r.reviewed_at,u.name AS reviewer FROM reviews r LEFT JOIN users u ON u.id=r.reviewer_id')
 return {r['edge_key']: {'status': r['status'], 'note': r['note'], 'graph': r['graph'], 'at': r['reviewed_at'].isoformat(), 'reviewer': r['reviewer']} for r in out}

def set_review(actor, key, status, graph=None, note=None):
 if not isinstance(key, str) or not 3 <= len(key) <= 2000: raise AuthError(400, 'รหัสเส้นไม่ถูกต้อง')
 if status not in ('ok', 'no', None): raise AuthError(400, 'สถานะไม่ถูกต้อง')
 with conn(True) as c:
  if status is None: c.run('DELETE FROM reviews WHERE edge_key=:k', k=key)
  else:
   c.run('INSERT INTO reviews(edge_key,status,note,graph,reviewer_id) VALUES(:k,:s,:n,:g,:u) '
         'ON CONFLICT(edge_key) DO UPDATE SET status=:s,note=:n,graph=:g,reviewer_id=:u,reviewed_at=now()',
         k=key, s=status, n=(note or '')[:1000] or None, g=json.dumps(graph, ensure_ascii=False) if graph else None, u=actor['id'])
  audit(c, actor, 'review', edge=key[:300], status=status)

def set_reviews_bulk(actor, keys, status, graph=None, note=None):
 """Record one decision for many edges at once (e.g. every agency→project link of one agency)."""
 if not isinstance(keys, list) or not 1 <= len(keys) <= 500: raise AuthError(400, 'เลือกได้ 1–500 รายการต่อครั้ง')
 if status not in ('ok', 'no'): raise AuthError(400, 'สถานะไม่ถูกต้อง')
 with conn(True) as c:
  for key in keys:
   if not isinstance(key, str) or not 3 <= len(key) <= 2000: raise AuthError(400, 'รหัสเส้นไม่ถูกต้อง')
   c.run('INSERT INTO reviews(edge_key,status,note,graph,reviewer_id) VALUES(:k,:s,:n,:g,:u) '
         'ON CONFLICT(edge_key) DO UPDATE SET status=:s,note=:n,graph=:g,reviewer_id=:u,reviewed_at=now()',
         k=key, s=status, n=(note or '')[:1000] or None, g=json.dumps(graph, ensure_ascii=False) if graph else None, u=actor['id'])
  audit(c, actor, 'review_bulk', count=len(keys), status=status, note=(note or '')[:200])

def ping():
 with conn() as c: c.run('SELECT 1')
