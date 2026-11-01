"""HTTP request handler: serves frontend/ as static files and dispatches /api/* to registered routes."""
import json, logging, sqlite3, threading, time, zipfile
from collections import deque
from http.cookies import SimpleCookie
from logging.handlers import RotatingFileHandler
from http.server import SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote

from config import APP, FRONTEND
from services import accounts
from services.procurement import db
from api import routes
from api import accounts_api, analytics_api, cases_api, data_api, evidence_api, identity_api  # noqa: F401  (modules register their routes on import)

MAX_BODY = 65536
RATE_LIMIT = 300            # API requests per minute per account (or per IP when signed out)
# Allowed while an account still has to replace an admin-set password.
MUST_CHANGE_ALLOWED = {'/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/stats', '/api/health'}
SECURITY_HEADERS = {
 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")

# Access log: method, path without query string (queries can contain personal names), status, time, account id.
(APP / 'logs').mkdir(exist_ok=True)
access_log = logging.getLogger('tor.access')
access_log.setLevel(logging.INFO); access_log.propagate = False
_log_file = RotatingFileHandler(APP / 'logs' / 'access.log', maxBytes=5_000_000, backupCount=5, encoding='utf-8')
_log_file.setFormatter(logging.Formatter('%(asctime)s %(message)s')); access_log.addHandler(_log_file)

_hits, _hits_lock = {}, threading.Lock()

def rate_limited(key):
 now = time.monotonic()
 with _hits_lock:
  window = _hits.setdefault(key, deque())
  while window and now - window[0] > 60: window.popleft()
  window.append(now)
  return len(window) > RATE_LIMIT
TIMEOUT_MESSAGE = 'การค้นหาใช้เวลานานเกินไป ลองใช้คำที่เจาะจงขึ้น รหัสโครงการ 11 หลัก หรือเลขนิติบุคคล 13 หลัก'


class Handler(SimpleHTTPRequestHandler):
 server_version = 'TOR'
 sys_version = ''

 def __init__(self, *args, **kwargs):
  # Static files come only from frontend/; databases and source files live outside it.
  super().__init__(*args, directory=str(FRONTEND), **kwargs)

 def parse_request(self):
  self._t0 = time.monotonic(); return super().parse_request()

 def log_message(self, *args): pass

 def log_request(self, code='-', size='-'):
  user = getattr(self, '_user', None)
  access_log.info('%s %s %s %s %.0fms user=%s', self.client_address[0], self.command, self.path.split('?', 1)[0], code,
                  (time.monotonic() - getattr(self, '_t0', time.monotonic())) * 1000, user['id'] if user else '-')

 def end_headers(self):
  for k, v in SECURITY_HEADERS.items(): self.send_header(k, v)
  if not self.path.startswith('/legacy/'): self.send_header('Content-Security-Policy', CSP)
  super().end_headers()

 def list_directory(self, path):
  # Never expose folder contents; only named files are served.
  self.send_error(404, 'Not found'); return None

 # ───── responses ─────
 def send_json(self, data, status=200, cookie=None):
  raw = json.dumps(data, ensure_ascii=False, default=str).encode()
  self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
  self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(raw)))
  if cookie is not None: self.send_header('Set-Cookie', cookie)
  self.end_headers(); self.wfile.write(raw)

 def send_file(self, raw, ctype, name, attach):
  self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Cache-Control', 'no-store')
  self.send_header('Content-Length', str(len(raw)))
  self.send_header('Content-Disposition', ('attachment' if attach else 'inline') + "; filename*=UTF-8''" + quote(name))
  self.end_headers(); self.wfile.write(raw)

 # ───── sessions: HttpOnly + SameSite=Strict cookie ─────
 def token(self):
  jar = SimpleCookie(); jar.load(self.headers.get('Cookie') or '')
  return jar['tor_session'].value if 'tor_session' in jar else None

 def current_user(self):
  if not hasattr(self, '_user'): self._user = accounts.session_user(self.token())
  return self._user

 def require(self, permission=None):
  user = self.current_user()
  if not user: raise accounts.AuthError(401, 'กรุณาเข้าสู่ระบบ')
  if permission and permission not in user['permissions']: raise accounts.AuthError(403, 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้')
  return user

 def send_session(self, token, user):
  return self.send_json({'user': accounts.public_user(user)},
   cookie=f'tor_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={accounts.SESSION_DAYS * 86400}')

 def check_access(self, route, path):
  user = self.require() if route.access == routes.LOGIN else self.require(route.access) if route.access else self.current_user()
  if user and user.get('must_change') and route.access and path not in MUST_CHANGE_ALLOWED:
   raise accounts.AuthError(403, 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน')
  if rate_limited(('user', user['id']) if user else ('ip', self.client_address[0])):
   raise accounts.AuthError(429, 'เรียกข้อมูลถี่เกินไป กรุณารอสักครู่')
  return user

 # ───── dispatch ─────
 def do_GET(self):
  url = urlparse(self.path)
  if not url.path.startswith('/api/'): return super().do_GET()
  route = routes.GET.get(url.path)
  query = parse_qs(url.query); q = lambda k, d='': query.get(k, [d])[0]
  try:
   if not route: return self.send_json({'error': 'ไม่พบ API'}, 404)
   self.check_access(route, url.path)
   if not route.db: return route.fn(self, q)
   with db() as c:
    if route.search:
     deadline = time.monotonic() + routes.SEARCH_SECONDS
     c.set_progress_handler(lambda: time.monotonic() > deadline, 20000)
    return route.fn(self, q, c)
  except accounts.AuthError as e: return self.send_json({'error': e.message}, e.status)
  except sqlite3.OperationalError as e:
   if 'interrupt' in str(e): return self.send_json({'error': TIMEOUT_MESSAGE, 'timeout': True}, 408)
   return self.send_json({'error': str(e)}, 400)
  except (ValueError, KeyError, zipfile.BadZipFile, sqlite3.Error) as e: return self.send_json({'error': str(e)}, 400)
  except ConnectionError: return  # client went away (BrokenPipe, Reset, Aborted)

 def do_POST(self):
  url = urlparse(self.path)
  try:
   route = routes.POST.get(url.path)
   if not route: return self.send_json({'error': 'ไม่พบ API'}, 404)
   # POST bodies must be JSON from this same origin (with SameSite=Strict this blocks cross-site requests).
   origin = self.headers.get('Origin')
   if origin and urlparse(origin).netloc != self.headers.get('Host'): raise accounts.AuthError(403, 'คำขอมาจากเว็บไซต์อื่น')
   if 'application/json' not in (self.headers.get('Content-Type') or ''): raise accounts.AuthError(415, 'ต้องส่งข้อมูลแบบ JSON')
   size = int(self.headers.get('Content-Length') or 0)
   if size > MAX_BODY: raise accounts.AuthError(413, 'ข้อมูลใหญ่เกินไป')
   body = json.loads(self.rfile.read(size) or b'{}')
   if not isinstance(body, dict): raise ValueError('รูปแบบข้อมูลไม่ถูกต้อง')
   user = self.check_access(route, url.path)
   return route.fn(self, body.get, user)
  except accounts.AuthError as e: return self.send_json({'error': e.message}, e.status)
  except (ValueError, TypeError) as e: return self.send_json({'error': str(e)}, 400)
  except ConnectionError: return  # client went away (BrokenPipe, Reset, Aborted)
