"""Investigations ("cases") and the publication workflow, plus public correction requests.

A case stores how a graph was built (start point, depth, branch, expanded nodes), not the graph itself.
Lifecycle: draft → submitted → published (or rejected), and published → withdrawn.
Only accounts with ``review.confirm`` may publish. Publishing rebuilds the graph on the server and keeps
only edges that are high-confidence or were reviewed as correct, so unverified links never go public.
"""
import json, re, secrets, threading, time

from services.accounts import AuthError, audit, conn, rows

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(
 id SERIAL PRIMARY KEY, slug TEXT UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
 spec JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','published','rejected','withdrawn')),
 review_note TEXT, snapshot JSONB, created_by INT REFERENCES users(id) ON DELETE SET NULL,
 reviewed_by INT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), published_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS corrections(
 id SERIAL PRIMARY KEY, case_slug TEXT, item TEXT, name TEXT NOT NULL, contact TEXT NOT NULL, message TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')), resolution TEXT,
 resolved_by INT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), resolved_at TIMESTAMPTZ);
"""
KINDS = ('project', 'company', 'person', 'agency')
STATUS_LABEL = {'draft': 'ฉบับร่าง', 'submitted': 'รอตรวจ', 'published': 'เผยแพร่แล้ว', 'rejected': 'ส่งกลับแก้ไข', 'withdrawn': 'ถอนการเผยแพร่'}


def init():
 with conn(True) as c:
  c.run('SELECT pg_advisory_xact_lock(7342002)')
  for stmt in SCHEMA.split(';'):
   if stmt.strip(): c.run(stmt)


# ───────── validation ─────────
def clean_spec(spec):
 if not isinstance(spec, dict): raise AuthError(400, 'ข้อมูลแผนผังไม่ถูกต้อง')
 def ref(r):
  if not isinstance(r, dict) or r.get('kind') not in KINDS or not isinstance(r.get('key'), str) or not 1 <= len(r['key']) <= 1000:
   raise AuthError(400, 'จุดเริ่มต้นหรือจุดที่ขยายไม่ถูกต้อง')
  return {'kind': r['kind'], 'key': r['key']}
 expanded = spec.get('expanded') or []
 if not isinstance(expanded, list) or len(expanded) > 30: raise AuthError(400, 'ขยายจุดได้ไม่เกิน 30 จุดต่อเรื่อง')
 return {**ref(spec), 'depth': max(1, min(3, int(spec.get('depth') or 2))), 'branch': max(3, min(48, int(spec.get('branch') or 8))),
         'expanded': [ref(r) for r in expanded],
         'hidden': [t for t in (spec.get('hidden') or []) if isinstance(t, str) and len(t) < 40][:10]}

def clean_text(value, label, low, high):
 value = re.sub(r'[ \t]+', ' ', (value or '').strip())
 if not low <= len(value) <= high: raise AuthError(400, f'{label}ต้องยาว {low}–{high} ตัวอักษร')
 return value


# ───────── queries ─────────
CASE_SQL = ('SELECT c.id,c.slug,c.title,c.summary,c.spec,c.status,c.review_note,c.created_at,c.updated_at,c.published_at,'
            'c.created_by,u.name AS author,r.name AS reviewer,(c.snapshot IS NOT NULL) AS has_snapshot,'
            "c.snapshot->'stats' AS stats FROM cases c LEFT JOIN users u ON u.id=c.created_by LEFT JOIN users r ON r.id=c.reviewed_by")

def _out(r):
 return {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in r.items()} | {'status_label': STATUS_LABEL[r['status']]}

def _get(c, case_id):
 found = rows(c, CASE_SQL + ' WHERE c.id=:i', i=int(case_id))
 if not found: raise AuthError(404, 'ไม่พบเรื่องนี้')
 return found[0]

def list_cases(actor, scope):
 reviewer = 'review.confirm' in actor['permissions']
 where = {'mine': 'c.created_by=:u', 'queue': "c.status='submitted'", 'published': "c.status='published'", 'all': 'true'}.get(scope)
 if where is None: raise AuthError(400, 'ขอบเขตไม่ถูกต้อง')
 if scope in ('queue', 'all') and not reviewer: raise AuthError(403, 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้')
 with conn() as c:
  return [_out(r) for r in rows(c, CASE_SQL + f' WHERE {where} ORDER BY c.updated_at DESC LIMIT 200', **({'u': actor['id']} if scope == 'mine' else {}))]

def get_case(actor, case_id):
 with conn() as c: r = _get(c, case_id)
 if r['created_by'] != actor['id'] and 'review.confirm' not in actor['permissions'] and r['status'] != 'published':
  raise AuthError(403, 'เปิดได้เฉพาะเจ้าของเรื่องหรือผู้ตรวจทาน')
 return _out(r)

def save_case(actor, case_id, title, summary, spec):
 title, summary, spec = clean_text(title, 'ชื่อเรื่อง', 3, 160), clean_text(summary, 'คำอธิบาย', 0, 4000), clean_spec(spec)
 with conn(True) as c:
  if case_id:
   r = _get(c, case_id)
   if r['created_by'] != actor['id']: raise AuthError(403, 'แก้ไขได้เฉพาะเจ้าของเรื่อง')
   if r['status'] not in ('draft', 'rejected'): raise AuthError(400, 'แก้ไขได้เฉพาะฉบับร่างหรือเรื่องที่ถูกส่งกลับ')
   c.run("UPDATE cases SET title=:t,summary=:s,spec=:p,status='draft',updated_at=now() WHERE id=:i", t=title, s=summary, p=json.dumps(spec, ensure_ascii=False), i=int(case_id))
   cid = int(case_id)
  else:
   cid = c.run('INSERT INTO cases(title,summary,spec,created_by) VALUES(:t,:s,:p,:u) RETURNING id', t=title, s=summary, p=json.dumps(spec, ensure_ascii=False), u=actor['id'])[0][0]
  audit(c, actor, 'case_save', case=cid, title=title)
  return _out(_get(c, cid))

def _transition(actor, case_id, allowed, new_status, owner_only=False, note=None, extra_sql='', **extra):
 with conn(True) as c:
  r = _get(c, case_id)
  if owner_only and r['created_by'] != actor['id']: raise AuthError(403, 'ทำได้เฉพาะเจ้าของเรื่อง')
  if r['status'] not in allowed: raise AuthError(400, f"เรื่องนี้อยู่ในสถานะ {STATUS_LABEL[r['status']]}")
  c.run(f'UPDATE cases SET status=:s,review_note=COALESCE(:n,review_note),updated_at=now(){extra_sql} WHERE id=:i',
        s=new_status, n=(note or '').strip()[:2000] or None, i=int(case_id), **extra)
  audit(c, actor, 'case_' + new_status, case=int(case_id), title=r['title'], note=(note or '')[:200])
  return _out(_get(c, case_id))

def submit_case(actor, case_id):
 return _transition(actor, case_id, ('draft', 'rejected'), 'submitted', owner_only=True)

def reject_case(actor, case_id, note):
 if not (note or '').strip(): raise AuthError(400, 'ระบุเหตุผลที่ส่งกลับ')
 return _transition(actor, case_id, ('submitted',), 'rejected', note=note, extra_sql=',reviewed_by=:rv', rv=actor['id'])

def withdraw_case(actor, case_id, note):
 return _transition(actor, case_id, ('published',), 'withdrawn', note=note, extra_sql=',reviewed_by=:rv', rv=actor['id'])

def delete_case(actor, case_id):
 with conn(True) as c:
  r = _get(c, case_id)
  if r['created_by'] != actor['id']: raise AuthError(403, 'ลบได้เฉพาะเจ้าของเรื่อง')
  if r['status'] not in ('draft', 'rejected'): raise AuthError(400, 'ลบได้เฉพาะฉบับร่างหรือเรื่องที่ถูกส่งกลับ')
  c.run('DELETE FROM cases WHERE id=:i', i=int(case_id)); audit(c, actor, 'case_delete', case=int(case_id), title=r['title'])

def spec_of(case_id):
 with conn() as c: return _get(c, case_id)['spec']

def publish_case(actor, case_id, note, snapshot):
 with conn(True) as c:
  r = _get(c, case_id)
  if r['status'] not in ('submitted', 'withdrawn'): raise AuthError(400, f"เผยแพร่ได้เฉพาะเรื่องที่รอตรวจ (ตอนนี้: {STATUS_LABEL[r['status']]})")
  slug = r['slug'] or f"{time.strftime('%y%m%d')}-{secrets.token_hex(3)}"
  snapshot = {**snapshot, 'title': r['title'], 'summary': r['summary'], 'published_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'reviewer': actor['name'], 'author': r['author']}
  c.run("UPDATE cases SET status='published',slug=:g,snapshot=:p,reviewed_by=:rv,review_note=COALESCE(:n,review_note),published_at=now(),updated_at=now() WHERE id=:i",
        g=slug, p=json.dumps(snapshot, ensure_ascii=False, default=str), rv=actor['id'], n=(note or '').strip()[:2000] or None, i=int(case_id))
  audit(c, actor, 'case_published', case=int(case_id), title=r['title'], slug=slug, **snapshot['stats'])
  return _out(_get(c, case_id))


# ───────── public side ─────────
def public_list():
 with conn() as c:
  out = rows(c, "SELECT slug,title,summary,published_at,snapshot->'stats' AS stats,snapshot->>'center_label' AS center_label,"
                "snapshot->>'scope' AS scope FROM cases WHERE status='published' ORDER BY published_at DESC LIMIT 200")
 for r in out: r['published_at'] = r['published_at'].isoformat()
 return out

def public_case(slug):
 with conn() as c:
  found = c.run("SELECT snapshot FROM cases WHERE slug=:s AND status='published'", s=slug or '')
 if not found: raise AuthError(404, 'ไม่พบเรื่องที่เผยแพร่นี้')
 return found[0][0]

def public_evidence_allowed(slug, archive=None, member=None, seq=None, dbd_source=None):
 """Public evidence downloads are limited to sources cited by that published case."""
 snap = public_case(slug)
 for item in snap['nodes'] + snap['edges']:
  ev = item.get('evidence')
  if dbd_source and (item.get('dbd_source') == dbd_source or ev == dbd_source): return True
  if archive and isinstance(ev, dict) and ev.get('archive') == archive and ev.get('member') == member and str(ev.get('sequence')) == str(seq): return True
 return False


# ───────── correction requests ─────────
_recent, _recent_lock = {}, threading.Lock()

def create_correction(ip, slug, item, name, contact, message):
 now = time.time()
 with _recent_lock:
  times = [t for t in _recent.get(ip, []) if now - t < 3600]
  if len(times) >= 5: raise AuthError(429, 'ส่งคำขอได้ไม่เกิน 5 ครั้งต่อชั่วโมง')
  _recent[ip] = times + [now]
 name, contact = clean_text(name, 'ชื่อผู้แจ้ง', 2, 120), clean_text(contact, 'ช่องทางติดต่อ', 3, 200)
 message, item = clean_text(message, 'รายละเอียด', 10, 4000), clean_text(item, 'รายการที่แจ้ง', 0, 500)
 with conn(True) as c:
  if slug and not c.run("SELECT 1 FROM cases WHERE slug=:s AND status='published'", s=slug): raise AuthError(404, 'ไม่พบเรื่องที่อ้างถึง')
  cid = c.run('INSERT INTO corrections(case_slug,item,name,contact,message) VALUES(:s,:i,:n,:c,:m) RETURNING id', s=slug or None, i=item or None, n=name, c=contact, m=message)[0][0]
  audit(c, None, 'correction_request', id=cid, case=slug)
 return {'id': cid}

def list_corrections(status='open'):
 with conn() as c:
  out = rows(c, 'SELECT k.*,u.name AS resolver FROM corrections k LEFT JOIN users u ON u.id=k.resolved_by '
                'WHERE (:s=\'all\' OR k.status=:s) ORDER BY k.created_at DESC LIMIT 200', s=status if status in ('open', 'resolved', 'rejected', 'all') else 'open')
 return [{k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in r.items()} for r in out]

def resolve_correction(actor, cid, status, resolution):
 if status not in ('resolved', 'rejected'): raise AuthError(400, 'สถานะไม่ถูกต้อง')
 resolution = clean_text(resolution, 'ผลการดำเนินการ', 3, 2000)
 with conn(True) as c:
  if not c.run('SELECT 1 FROM corrections WHERE id=:i', i=int(cid)): raise AuthError(404, 'ไม่พบคำขอ')
  c.run('UPDATE corrections SET status=:s,resolution=:r,resolved_by=:u,resolved_at=now() WHERE id=:i', s=status, r=resolution, u=actor['id'], i=int(cid))
  audit(c, actor, 'correction_' + status, id=int(cid))
