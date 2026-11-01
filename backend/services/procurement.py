"""Read-only access to the procurement SQLite database and the original per-project graph."""
import hashlib, json, re, sqlite3, zlib
from config import DB, IDENTITY

def unpack(blob):return json.loads(zlib.decompress(blob))
def norm(s):return re.sub(r'\s+','',s or '').casefold()
# When identity.sqlite3 exists, a temporary view named `bids` shadows the table so reads by project, ID or name see the
# extra bidder links (bid_links_v2). The columns are unchanged; only rows the import left unresolved get a link.
# Lookups BY COMPANY must not use the view (the linked ID is computed, so no index applies): use bid_rows_of_cid().
_BIDS_VIEW=('CREATE TEMP VIEW bids AS SELECT b.id,b.pid,b.item,b.name,b.name_key,b.amount,b.source,b.seq,b.hash,b.raw,'
 'COALESCE(b.linked_cid,l.cid) AS linked_cid,'
 'CASE WHEN b.linked_cid IS NULL AND l.cid IS NOT NULL THEN l.method ELSE b.link_method END AS link_method '
 'FROM main.bids b LEFT JOIN idn.bid_links_v2 l ON l.bid_id=b.id AND b.linked_cid IS NULL')
def db():
 c=sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=60);c.row_factory=sqlite3.Row
 if IDENTITY.exists():
  c.execute('ATTACH DATABASE ? AS idn',(IDENTITY.as_uri()+'?mode=ro',));c.execute(_BIDS_VIEW)
 return c
def bid_rows_of_cid(c):
 """(sql, parameter count) for the bid rows linked to one company: the import's links plus bid_links_v2.
 The SQL returns id, pid, source, linked_cid; pass the company ID once per parameter."""
 sql='SELECT id,pid,source,linked_cid FROM main.bids WHERE linked_cid=?'
 if any(r[1]=='idn' for r in c.execute('PRAGMA database_list')):
  return sql+' UNION ALL SELECT b.id,b.pid,b.source,l.cid FROM idn.bid_links_v2 l JOIN main.bids b ON b.id=l.bid_id WHERE l.cid=?',2
 return sql,1
def source(c,sid,seq):
 r=c.execute('SELECT path,member FROM sources WHERE id=?',(sid,)).fetchone()
 return {'archive':r['path'],'member':r['member'],'sequence':seq}

def project_graph(c,pid):
 rows=c.execute('SELECT * FROM contracts WHERE pid=? ORDER BY year DESC,id DESC LIMIT 2001',(pid,)).fetchall()
 bids=c.execute('SELECT * FROM bids WHERE pid=? ORDER BY id LIMIT 2001',(pid,)).fetchall()
 if not rows and not bids:return None
 nodes={};edges=[];contracts=[];bidraw=[];seen=set();role_seen=set();missing=[]
 def node(key,typ,label,**kw):
  if key not in nodes:nodes[key]={'id':key,'type':typ,'label':label,**kw}
  return key
 p='project:'+pid
 first=unpack(rows[0]['raw']) if rows else {'รหัสโครงการ':pid,'ชื่อโครงการจัดซื้อจัดจ้าง':'โครงการ '+pid+' (มีเฉพาะข้อมูลผู้เสนอราคา)','ชื่อหน่วยงานย่อย':'ไม่พบข้อมูลสัญญา','ชื่อวิธีการจัดซื้อจัดจ้าง':'ไม่พบข้อมูลสัญญา','สถานะสัญญา':'ไม่ทราบ','เลขที่สัญญา':'ไม่ทราบ','วันที่ลงนามในสัญญา':'ไม่ทราบ','วงเงินงบประมาณในสัญญา (บาท)':None}
 node(p,'Project',first.get('ชื่อโครงการจัดซื้อจัดจ้าง') or pid)
 for row in rows[:2000]:
  if row['hash'] in seen:continue
  seen.add(row['hash']);r=unpack(row['raw']);proof=source(c,row['source'],row['seq']);contracts.append({'data':r,'source':proof})
  agency=r.get('ชื่อหน่วยงานย่อย') or r.get('ชื่อหน่วยงาน') or 'ไม่ระบุหน่วยงาน';a=node('agency:'+hashlib.sha256((str(r.get('ชื่อหน่วยงาน'))+'|'+agency).encode()).hexdigest()[:20],'Agency',agency,identity_status='temporary_name_key')
  edges.append({'source':a,'target':p,'type':'PROCURES','evidence':proof})
  cid=row['cid'];company=c.execute('SELECT c.*,o.source,o.observed FROM companies c JOIN registry_observations o ON o.id=c.latest_obs WHERE c.cid=?',(cid,)).fetchone()
  key='organization:'+cid if re.fullmatch(r'\d{13}',cid or '') else 'unresolved-winner:'+pid+':'+row['winner_key']
  org=node(key,'Organization' if company else 'UnresolvedBidder',r.get('ชื่อผู้ชนะการเสนอราคา') or 'ไม่ระบุผู้ชนะ',company_id=cid,identity_status='registry_id_match' if company else 'registry_not_found',dbd_source=company['source'] if company else None,observed=company['observed'] if company else None,is_winner=True)
  edges.append({'source':p,'target':org,'type':'AWARDED_TO','amount':r.get('วงเงินงบประมาณในสัญญา (บาท)'),'contract_number':r.get('เลขที่สัญญา'),'evidence':proof})
  if not company:missing.append('ผู้ชนะ '+(r.get('ชื่อผู้ชนะการเสนอราคา') or cid)+' ยังเชื่อมกับทะเบียน DBD ไม่ได้')
  if company and cid not in role_seen:
   role_seen.add(cid)
   for role in c.execute('SELECT * FROM registry_roles WHERE cid=? AND obs=?',(cid,company['latest_obs'])):
    related=node(role['entity_key'],role['kind'],role['name'],investAmount=role['amount'],entity_key=role['entity_key'],related_cid=role['related_cid'],identity_status='identifier_matched_across_observations' if not role['entity_key'].startswith('mention:') else 'unresolved_mention',dbd_source=company['source'])
    edges.append({'source':related,'target':org,'type':'REPORTED_RELATED_PARTY','raw_role_code':role['raw_role'],'amount':role['amount'],'evidence':company['source']})
 seen_bids=set()
 for bid in bids[:2000]:
  if bid['hash'] in seen_bids:continue
  seen_bids.add(bid['hash']);raw=unpack(bid['raw']);bidraw.append(raw)
  it=node('item:'+pid+':'+str(bid['item']),'TenderItem',raw.get('ชื่อรายการพิจารณา') or 'รายการ '+str(bid['item']))
  edges.append({'source':p,'target':it,'type':'HAS_ITEM'})
  cid=bid['linked_cid'];confirmed=bid['link_method']=='same_project_winner_name'
  if confirmed and 'organization:'+str(cid) in nodes:org='organization:'+cid
  else:org=node('bidder:'+pid+':'+bid['name_key'],'UnresolvedBidder',bid['name'],company_id=cid,identity_status=bid['link_method'],is_winner=False)
  edges.append({'source':org,'target':it,'type':'BID_ON','amount':bid['amount'],'link_method':bid['link_method'],'evidence':source(c,bid['source'],bid['seq'])})
 if not bids:missing.append('ไม่มีรายชื่อผู้เสนอราคาของโครงการนี้ในชุดข้อมูลที่นำเข้า')
 number=first.get('เลขที่สัญญา') or ''
 if not re.search(r'[\wก-๙]',number.replace('2569','').replace('2568','').replace('2567','').replace('2566','').replace('2565','').replace('_','')):missing.append('เลขที่สัญญาว่างหรือไม่สมบูรณ์')
 unique_edges=[];ek=set()
 for edge in edges:
  k=json.dumps(edge,ensure_ascii=False,sort_keys=True)
  if k not in ek:ek.add(k);unique_edges.append(edge)
 meta=c.execute('SELECT * FROM projects WHERE pid=?',(pid,)).fetchone()
 # Signing conditions remain quoted source text, separate from inferred relationships.
 signing=[]
 for cid in role_seen:
  signing.extend(dict(r) for r in c.execute('SELECT s.cid,s.description FROM signing_conditions s JOIN companies c ON c.cid=s.cid AND c.latest_obs=s.obs WHERE s.cid=?',(cid,)))

 return {'id':pid,'short':pid,'amount':first.get('วงเงินงบประมาณในสัญญา (บาท)'),'contract':first,'companyId':first.get('เลขประจำตัวนิติบุคคล 13 หลัก'),'companyName':first.get('ชื่อผู้ชนะการเสนอราคา'),'bidderCount':len({b['ชื่อผู้เสนอราคา'] for b in bidraw}),'bids':bidraw,'nodes':list(nodes.values()),'edges':unique_edges,'finding':' · '.join(dict.fromkeys(missing)) or 'เชื่อมข้อมูลตามรหัสโครงการและรหัสนิติบุคคลแล้ว ยังต้องตรวจหลักฐานและช่วงเวลาของบทบาท','missing':'ชื่อผู้เสนอราคาที่จับคู่จากชื่อทะเบียนเพียงอย่างเดียวยังคงเป็นตัวตนรอยืนยัน; ข้อมูลทะเบียนไม่ยืนยันบทบาท ณ วันประมูล','contractSource':json.dumps(contracts[0]['source'],ensure_ascii=False) if contracts else 'ไม่มีข้อมูลสัญญา','bidSource':'ข้อมูลรายชื่อผู้เสนอราคาใน Data.go.th','dbdSource':'ตรวจแหล่งอ้างอิงรายจุด','contracts':contracts,'signing_conditions':signing,'coverage':{'source_contract_rows':meta['contract_rows'] if meta else len(rows),'distinct_contract_records_loaded':len(contracts),'bid_rows_loaded':len(bidraw),'truncated':len(rows)>2000 or len(bids)>2000,'bid_link_methods':dict(c.execute('SELECT link_method,COUNT(*) FROM bids WHERE pid=? GROUP BY link_method',(pid,)))}}
