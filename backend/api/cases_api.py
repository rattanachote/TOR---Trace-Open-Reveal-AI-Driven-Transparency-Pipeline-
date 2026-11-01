"""Saved investigations, the publish workflow, the public portal and correction requests."""
from api.routes import get, post, LOGIN
from api.evidence_api import evidence_dbd, evidence_row
from services import accounts, cases
from services.procurement import db
from services.snapshot import build_snapshot


# ───── internal: cases ─────
@get('/api/cases', LOGIN)
def list_cases(h, q):
 return h.send_json({'items': cases.list_cases(h.current_user(), q('scope', 'mine'))})

@get('/api/cases/get', LOGIN)
def get_case(h, q):
 return h.send_json(cases.get_case(h.current_user(), q('id')))

@post('/api/cases/save', 'data.view')
def save_case(h, b, user):
 return h.send_json(cases.save_case(user, b('id'), b('title'), b('summary'), b('spec')))

@post('/api/cases/submit', 'data.view')
def submit_case(h, b, user):
 return h.send_json(cases.submit_case(user, b('id')))

@post('/api/cases/delete', 'data.view')
def delete_case(h, b, user):
 cases.delete_case(user, b('id')); return h.send_json({'ok': True})

@post('/api/cases/preview', 'review.confirm')
def preview_case(h, b, user):
 """Show the reviewer what would be published, without publishing."""
 with db() as c: snap = build_snapshot(c, cases.spec_of(b('id')), accounts.all_reviews())
 return h.send_json({'stats': snap['stats'], 'center_label': snap['center_label']})

@post('/api/cases/publish', 'review.confirm')
def publish_case(h, b, user):
 with db() as c: snap = build_snapshot(c, cases.spec_of(b('id')), accounts.all_reviews())
 if not snap['edges']: raise accounts.AuthError(400, 'ไม่มีเส้นที่ผ่านการยืนยันให้เผยแพร่')
 return h.send_json(cases.publish_case(user, b('id'), b('note'), snap))

@post('/api/cases/reject', 'review.confirm')
def reject_case(h, b, user):
 return h.send_json(cases.reject_case(user, b('id'), b('note')))

@post('/api/cases/withdraw', 'review.confirm')
def withdraw_case(h, b, user):
 return h.send_json(cases.withdraw_case(user, b('id'), b('note')))


# ───── internal: correction requests ─────
@get('/api/corrections', 'review.confirm')
def list_corrections(h, q):
 return h.send_json({'items': cases.list_corrections(q('status', 'open'))})

@post('/api/corrections/resolve', 'review.confirm')
def resolve_correction(h, b, user):
 cases.resolve_correction(user, b('id'), b('status'), b('resolution')); return h.send_json({'ok': True})


# ───── public portal (no account) ─────
@get('/api/public/cases')
def public_cases(h, q):
 return h.send_json({'items': cases.public_list()})

@get('/api/public/case')
def public_case(h, q):
 return h.send_json(cases.public_case(q('slug')))

@get('/api/public/evidence/row', db=True, search=True)
def public_evidence_row(h, q, c):
 if not cases.public_evidence_allowed(q('slug'), archive=q('archive'), member=q('member'), seq=q('seq')):
  raise accounts.AuthError(403, 'ดาวน์โหลดได้เฉพาะหลักฐานที่อ้างถึงในเรื่องที่เผยแพร่')
 return evidence_row(h, q, c)

@get('/api/public/evidence/dbd', db=True, search=True)
def public_evidence_dbd(h, q, c):
 if not cases.public_evidence_allowed(q('slug'), dbd_source=q('source')):
  raise accounts.AuthError(403, 'ดาวน์โหลดได้เฉพาะหลักฐานที่อ้างถึงในเรื่องที่เผยแพร่')
 return evidence_dbd(h, q, c)

@post('/api/public/corrections')
def create_correction(h, b, user):
 return h.send_json(cases.create_correction(h.client_address[0], b('slug'), b('item'), b('name'), b('contact'), b('message')))
