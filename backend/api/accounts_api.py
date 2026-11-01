"""Sign-in, registration, admin (users/roles/audit) and review-decision endpoints."""
from api.routes import get, post, LOGIN
from services import accounts

LOGOUT_COOKIE = 'tor_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'


# ───── session ─────
@get('/api/auth/me')
def me(h, q):
 user = h.current_user()
 if not user: return h.send_json({'error': 'กรุณาเข้าสู่ระบบ'}, 401)
 return h.send_json({'user': accounts.public_user(user), 'catalog': accounts.PERMISSIONS})

@post('/api/auth/login')
def login(h, b, user):
 return h.send_session(*accounts.login(b('username'), b('password'), h.client_address[0]))

@post('/api/auth/register')
def register(h, b, user):
 return h.send_session(*accounts.register(b('username'), b('name'), b('password')))

@post('/api/auth/logout')
def logout(h, b, user):
 accounts.logout(h.token()); return h.send_json({'ok': True}, cookie=LOGOUT_COOKIE)

@post('/api/auth/password', LOGIN)
def change_password(h, b, user):
 accounts.change_password(user, b('current'), b('new')); return h.send_json({'ok': True})


# ───── review decisions (confirm data before publishing) ─────
@get('/api/reviews', 'data.view')
def reviews(h, q):
 return h.send_json(accounts.all_reviews())

@post('/api/reviews', 'review.confirm')
def set_review(h, b, user):
 accounts.set_review(user, b('key'), b('status'), b('graph'), b('note')); return h.send_json(accounts.all_reviews())

@post('/api/reviews/bulk', 'review.confirm')
def set_reviews_bulk(h, b, user):
 accounts.set_reviews_bulk(user, b('keys'), b('status'), b('graph'), b('note')); return h.send_json(accounts.all_reviews())


# ───── administration ─────
@get('/api/admin/users', 'users.manage')
def list_users(h, q):
 return h.send_json({'users': accounts.list_users(), 'roles': accounts.list_roles()})

@get('/api/admin/roles', 'roles.manage')
def list_roles(h, q):
 return h.send_json({'roles': accounts.list_roles(), 'catalog': accounts.PERMISSIONS})

@get('/api/admin/audit', LOGIN)
def audit(h, q):
 if not {'users.manage', 'roles.manage'} & set(h.current_user()['permissions']):
  raise accounts.AuthError(403, 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้')
 return h.send_json({'items': accounts.audit_log()})

@post('/api/admin/users/create', 'users.manage')
def create_user(h, b, user):
 return h.send_json(accounts.create_user(user, b('username'), b('name'), b('password'), b('role') or 'user'))

@post('/api/admin/users/update', 'users.manage')
def update_user(h, b, user):
 return h.send_json(accounts.update_user(user, b('id'), b('role'), b('active'), b('name'), b('password')))

@post('/api/admin/roles/save', 'roles.manage')
def save_role(h, b, user):
 return h.send_json({'roles': accounts.save_role(user, b('name'), b('label'), b('permissions'))})

@post('/api/admin/roles/delete', 'roles.manage')
def delete_role(h, b, user):
 return h.send_json({'roles': accounts.delete_role(user, b('name'))})
