"""Search, browse and graph endpoints over the read-only procurement database."""
import json, re, sqlite3, time, zlib
from collections import Counter
from api.routes import get
from config import ANALYTICS, DATA, ROOT
from services import accounts, identity
from services.procurement import db, bid_rows_of_cid
from services.graphs import entity_graph
from services.procurement import project_graph
from services.textnorm import compact, like, like_any


_as_of = {}

def as_of():
 """When each source was collected: e-GP archive dates, DBD snapshot dates, analytics build time."""
 if not _as_of:
  egp = sorted({time.strftime('%Y-%m-%d', time.localtime(f.stat().st_mtime)) for f in (ROOT/'Data.go.th').rglob('*.zip')})
  with db() as c: lo, hi = c.execute('SELECT MIN(substr(observed,1,10)),MAX(substr(observed,1,10)) FROM registry_observations').fetchone()
  _as_of.update(egp_files=egp, dbd_from=lo, dbd_to=hi)
 out = dict(_as_of)
 if ANALYTICS.exists():
  with sqlite3.connect(ANALYTICS.as_uri()+'?mode=ro', uri=True) as a: out['analytics_built'] = dict(a.execute('SELECT key,value FROM meta')).get('built_at')
 return out


@get('/api/stats')
def stats(h, q):
 path=DATA/'summary.json';return h.send_json({'complete':path.exists(),'summary':json.loads(path.read_text(encoding='utf-8')) if path.exists() else None,'progress':json.loads((DATA/'progress.json').read_text(encoding='utf-8')) if (DATA/'progress.json').exists() else {},'as_of':as_of()})


@get('/api/health')
def health(h, q):
 checks = {}
 try:
  with db() as c: c.execute('SELECT 1 FROM sources LIMIT 1').fetchone(); checks['procurement_db'] = 'ok'
 except sqlite3.Error as e: checks['procurement_db'] = 'error: ' + str(e)
 try: accounts.ping(); checks['accounts_db'] = 'ok'
 except Exception as e: checks['accounts_db'] = 'error: ' + type(e).__name__
 checks['analytics_db'] = 'ok' if ANALYTICS.exists() else 'missing'
 ok = checks['procurement_db'] == checks['accounts_db'] == 'ok'
 return h.send_json({'ok': ok, 'checks': checks}, 200 if ok else 503)

@get('/api/entity-graph', 'data.view', db=True)
def entity_graph_route(h, q, c):
 kind=q('kind');value=q('key');size=max(3,min(48,int(q('limit','8'))));depth=max(1,min(3,int(q('depth','1'))))
 if kind not in ['project','company','person','agency'] or not value or len(value)>1000:return h.send_json({'error':'ระบุประเภทและตัวตั้งของกราฟให้ถูกต้อง'},400)
 result=entity_graph(c,kind,value,size,depth,identity.confirmed_same_person(accounts.all_reviews()))
 return h.send_json(result if result else {'error':'ไม่พบข้อมูลสำหรับกราฟนี้'},200 if result else 404)

_UNITS = {}

def agency_units(c, sub):
 """Parent agencies that use this sub-agency name (only asked for names listed in identity.sqlite3)."""
 if sub not in _UNITS:
  seen = Counter()
  for (raw,) in c.execute('SELECT raw FROM contracts WHERE agency=? LIMIT 30000', (sub,)):
   parent = (json.loads(zlib.decompress(raw)).get('ชื่อหน่วยงาน') or '').strip()
   if parent and compact(parent) != compact(sub): seen[parent] += 1
  _UNITS[sub] = [{'parent': p, 'rows': n} for p, n in seen.most_common(30) if n >= 3]
 return _UNITS[sub]

@get('/api/agencies', 'data.view', db=True, search=True)
def agencies(h, q, c):
 size=max(1,min(50,int(q('limit','30'))));cursor=q('cursor');term=q('q').strip();min_rows=max(0,min(100000000,int(q('min_rows','0'))))
 cond,found=like_any('name',like(term));rows=c.execute('SELECT name,source_rows FROM agency_catalog WHERE name>? AND '+cond+' AND source_rows>=? ORDER BY name LIMIT ?',(cursor,*found,min_rows,size+1)).fetchall();page=rows[:size]
 items=[dict(r) for r in page]
 for it in items:
  if identity.agency_parents(it['name']):it['units']=agency_units(c,it['name'])
 return h.send_json({'items':items,'next':page[-1]['name'] if len(rows)>size else None,'identity_note':'จัดกลุ่มจากชื่อหน่วยงาน ยังไม่มีรหัสทางการ'})

@get('/api/project', 'data.view', db=True, search=True)
def project(h, q, c):
 pid=q('id')
 if not re.fullmatch(r'\d{11}',pid):return h.send_json({'error':'รหัสโครงการต้องมี 11 หลัก'},400)
 result=project_graph(c,pid);return h.send_json(result if result else {'error':'ไม่พบโครงการ'},200 if result else 404)

@get('/api/projects', 'data.view', db=True, search=True)
def projects(h, q, c):
 limit=max(1,min(50,int(q('limit','30'))));after=int(q('after','0'));term=q('q').strip()
 cid=q('cid');year=q('year');TAIL=1000000000
 if term.isdigit() and len(term)==11:
  if year:found=c.execute('SELECT p.pid,p.contract_row,t.id,t.cid,t.year,t.title,t.agency FROM projects p JOIN contracts t ON t.pid=p.pid WHERE p.pid=? AND t.year=? ORDER BY t.id DESC LIMIT 1',(term,int(year))).fetchone()
  else:found=c.execute('SELECT p.pid,p.contract_row,t.id,t.cid,t.year,t.title,t.agency FROM projects p LEFT JOIN contracts t ON t.id=p.contract_row WHERE p.pid=?',(term,)).fetchone()
  if found:
   item=dict(found)
   if not item['title']:item.update(title='โครงการ '+term+' (มีเฉพาะข้อมูลผู้เสนอราคา)',agency='ไม่พบข้อมูลสัญญา',year='ไม่ทราบ')
   return h.send_json({'items':[item],'next':None})
 def bid_page(start,capacity):
  conditions=['b.id>?'];args=[start];source='bids b'
  if cid or (term.isdigit() and len(term)==13):
   sql,n=bid_rows_of_cid(c);source='('+sql+') b';args=[cid or term]*n+args
  elif term and not term.isdigit():cond,found=like_any('b.name_key','%'+compact(term)+'%');conditions.append(cond);args.extend(found)
  elif term.isdigit():conditions.extend(['b.pid>=?','b.pid<?']);args.extend([term,term+'\uffff'])
  else:conditions.append('p.contract_row IS NULL')
  if year:conditions.append('s.year=?');args.append(int(year))
  return c.execute("SELECT b.id+1000000000 AS id,b.pid,b.linked_cid AS cid,s.year,COALESCE(t.title,'โครงการ '||b.pid||' (มีเฉพาะผู้เสนอราคา)') AS title,t.agency FROM "+source+" JOIN sources s ON s.id=b.source LEFT JOIN projects p ON p.pid=b.pid LEFT JOIN contracts t ON t.id=p.contract_row WHERE "+' AND '.join(conditions)+' ORDER BY b.id LIMIT ?',args+[capacity+1]).fetchall()
 if after>=TAIL:
  rows=bid_page(after-TAIL,limit);page=rows[:limit];next_value=page[-1]['id'] if len(rows)>limit else None
 else:
  args=[after];conditions=['t.id>?']
  if cid:conditions.append('t.cid=?');args.append(cid)
  if year:conditions.append('t.year=?');args.append(int(year))
  if term:
   if term.isdigit() and len(term)==13:conditions.append('t.cid=?');args.append(term)
   elif term.isdigit():conditions.extend(['t.pid>=?','t.pid<?']);args.extend([term,term+'\uffff'])
   else:
    cond,found=like_any('name_key','%'+compact(term)+'%');candidates=[r[0] for r in c.execute('SELECT cid FROM companies WHERE '+cond+' LIMIT 101',found)]
    if candidates and len(candidates)<=100:
     conditions.append('t.cid IN ('+','.join('?' for _ in candidates)+')');args.extend(candidates)
    else:
     parts=[like_any(col,pat) for col,pat in (('t.title',like(term)),('t.agency',like(term)),('t.winner_key','%'+compact(term)+'%'))]
     conditions.append('('+' OR '.join(p[0] for p in parts)+')');args.extend(a for p in parts for a in p[1])
  rows=c.execute('SELECT t.id,t.pid,t.cid,t.year,t.title,t.agency FROM contracts t WHERE '+' AND '.join(conditions)+' ORDER BY t.id LIMIT ?',args+[limit+1]).fetchall();page=list(rows[:limit])
  if len(rows)>limit:next_value=page[-1]['id']
  else:
   extra=bid_page(0,limit-len(page));space=limit-len(page);page.extend(extra[:space]);next_value=extra[space-1]['id'] if space and len(extra)>space else (TAIL if not space and extra else None)
 items=[];seen=set()
 for row in page:
  if row['pid'] in seen:continue
  seen.add(row['pid']);items.append(dict(row))
 return h.send_json({'items':items,'next':next_value,'pagination_unit':'source_records','note':'ค้นทั้งสัญญาและชื่อผู้เสนอราคา; ผู้เสนอราคาที่เชื่อมจากชื่อทะเบียนเพียงอย่างเดียวยังต้องยืนยัน'})

@get('/api/companies', 'data.view', db=True, search=True)
def companies(h, q, c):
 limit=max(1,min(50,int(q('limit','30'))));after=int(q('after','0'));term=q('q').strip()
 aftercid=q('cursor');with_contracts=q('with_contracts')=='1';cond,found=like_any('name_key','%'+compact(term)+'%');conditions=['cid>?','('+cond+' OR cid LIKE ?)'];args=[aftercid,*found,'%'+term+'%']
 if with_contracts:conditions.append('EXISTS(SELECT 1 FROM contracts t WHERE t.cid=companies.cid)')
 rows=c.execute('SELECT cid,name,latest_obs FROM companies WHERE '+' AND '.join(conditions)+' ORDER BY cid LIMIT ?',args+[limit+1]).fetchall();page=rows[:limit]
 items=[]
 for r in page:
  d=dict(r);d['contract_rows']=c.execute('SELECT COUNT(*) FROM contracts WHERE cid=?',(r['cid'],)).fetchone()[0];items.append(d)
 return h.send_json({'items':items,'next':page[-1]['cid'] if len(rows)>limit else None})

@get('/api/people', 'data.view', db=True, search=True)
def people(h, q, c):
 limit=max(1,min(50,int(q('limit','30'))));after=int(q('after','0'));term=q('q').strip()
 kind=q('kind');cond,found=like_any('r.name',like(term));conditions=['r.rowid>?',cond];args=[after,*found]
 if kind in ('PersonMention','OrganizationMention'):conditions.append('r.kind=?');args.append(kind)
 rows=c.execute('SELECT r.rowid AS rid,r.* FROM registry_roles r JOIN companies c ON c.cid=r.cid AND c.latest_obs=r.obs WHERE '+' AND '.join(conditions)+' ORDER BY r.rowid LIMIT ?',args+[limit+1]).fetchall();page=rows[:limit]
 return h.send_json({'items':[dict(r) for r in page],'next':page[-1]['rid'] if len(rows)>limit else None})

@get('/api/related', 'data.view', db=True, search=True)
def related(h, q, c):
 key=q('key');rows=c.execute('SELECT DISTINCT r.cid,c.name FROM registry_roles r JOIN companies c ON c.cid=r.cid AND c.latest_obs=r.obs WHERE r.entity_key=? LIMIT 101',(key,)).fetchall()
 return h.send_json({'companies':[dict(r) for r in rows[:100]],'truncated':len(rows)>100,'identity_note':('รายการนี้ไม่มีตัวระบุ จึงแสดงเฉพาะแหล่งนี้และไม่รวมกับชื่อที่เหมือนกัน' if key.startswith('mention:') else 'เชื่อมจากตัวระบุในต้นทางที่ตรวจรูปแบบแล้ว ยังต้องตรวจความถูกต้องและช่วงเวลาของบทบาท')})

@get('/api/quality', 'data.view', db=True, search=True)
def quality(h, q, c):
 limit=max(1,min(50,int(q('limit','30'))));after=int(q('after','0'));term=q('q').strip()
 rows=c.execute('SELECT r.rowid AS rid,r.source,r.record,r.reason,s.path,s.member FROM rejected r JOIN sources s ON s.id=r.source WHERE r.rowid>? ORDER BY r.rowid LIMIT ?',(after,limit+1)).fetchall();page=rows[:limit]
 return h.send_json({'items':[dict(r) for r in page],'next':page[-1]['rid'] if len(rows)>limit else None})
