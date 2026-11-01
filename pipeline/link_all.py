"""Local, resumable source-preserving procurement and registry ingestion."""
import csv, io, json, os, re, sqlite3, sys, time, zlib, hashlib, zipfile, unicodedata
from pathlib import Path
from collections import Counter
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor

csv.field_size_limit(16*1024*1024)
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output'/'linked-data';OUT.mkdir(parents=True,exist_ok=True)
DB=OUT/'procurement.sqlite3'
def norm(s):return re.sub(r'\s+','',unicodedata.normalize('NFKC',str(s or ''))).casefold()
@lru_cache(maxsize=500000)
def valid_id(s):
 s=str(s or '').strip()
 return len(s)==13 and s.isascii() and s.isdigit() and (11-sum(int(s[i])*(13-i) for i in range(12))%11)%10==int(s[-1])
def packed(x):return zlib.compress(json.dumps(x,ensure_ascii=False,separators=(',',':')).encode('utf-8'),1)
def fingerprint(row):return hashlib.blake2b(json.dumps({k:v for k,v in row.items() if k!='ลำดับ'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode(),digest_size=16).digest()
def progress(stage,**kw):
 d={'stage':stage,'updated':time.strftime('%Y-%m-%dT%H:%M:%S'),**kw};(OUT/'progress.json').write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(d,ensure_ascii=False),flush=True)

con=sqlite3.connect(DB,timeout=60)
con.executescript('''PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA temp_store=FILE;PRAGMA cache_size=-196608;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,path TEXT,member TEXT,kind TEXT,year INTEGER,status TEXT,rows_read INTEGER DEFAULT 0,accepted INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,UNIQUE(path,member));
CREATE TABLE IF NOT EXISTS registry_observations(id INTEGER PRIMARY KEY,cid TEXT,observed TEXT,source TEXT UNIQUE,content_hash TEXT,company BLOB);
CREATE TABLE IF NOT EXISTS registry_roles(obs INTEGER,cid TEXT,entity_key TEXT,name TEXT,kind TEXT,related_cid TEXT,amount TEXT,raw_role TEXT,source_seq TEXT);
CREATE TABLE IF NOT EXISTS companies(cid TEXT PRIMARY KEY,name TEXT,name_key TEXT,latest_obs INTEGER);
CREATE TABLE IF NOT EXISTS aliases(name_key TEXT,cid TEXT,PRIMARY KEY(name_key,cid));
CREATE TABLE IF NOT EXISTS contracts(id INTEGER PRIMARY KEY,pid TEXT,cid TEXT,winner_key TEXT,year INTEGER,source INTEGER,seq TEXT,hash BLOB,raw BLOB);
CREATE TABLE IF NOT EXISTS bids(id INTEGER PRIMARY KEY,pid TEXT,item TEXT,name TEXT,name_key TEXT,amount TEXT,source INTEGER,seq TEXT,hash BLOB,raw BLOB,linked_cid TEXT,link_method TEXT);
CREATE TABLE IF NOT EXISTS rejected(source INTEGER,record INTEGER,reason TEXT,raw BLOB);
''')
cols={r[1] for r in con.execute('PRAGMA table_info(contracts)')}
for column in ['title','agency']:
 if column not in cols:con.execute('ALTER TABLE contracts ADD COLUMN '+column+' TEXT')
con.commit()

def observations():
 paths=[]
 for date in sorted(ROOT.glob('20??-??-??')):
  if not date.is_dir():continue
  for c in os.scandir(date):
   if not c.is_dir():continue
   for sub in os.scandir(c.path):
    if sub.is_dir():
     f=Path(sub.path)/'company.json'
     if f.is_file():paths.append(f)
 return paths

def read_registry(path):
 try:
  raw=path.read_bytes();data=json.loads(raw.decode('utf-8-sig'))
  manifest=path.parent/'manifest.json';m=json.loads(manifest.read_text(encoding='utf-8-sig')) if manifest.exists() else {}
  return path,data,m,hashlib.sha256(raw).hexdigest(),None
 except Exception as e:return path,None,None,None,str(e)

if not con.execute("SELECT 1 FROM meta WHERE key='registry_complete'").fetchone():
 progress('registry_inventory')
 paths=observations();known={r[0] for r in con.execute('SELECT source FROM registry_observations')}
 counters=Counter();registry_errors=[]
 def store_registry(source,d,m,h):
  c=d.get('company') or {};cid=str(c.get('jpNo') or m.get('tax_id') or '').strip()
  if not valid_id(cid):counters['invalid_company_id']+=1;return
  stamp=m.get('checked_at') or m.get('date') or source[:10]
  cur=con.execute('INSERT OR IGNORE INTO registry_observations(cid,observed,source,content_hash,company) VALUES(?,?,?,?,?)',(cid,stamp,source,h,packed(c)))
  if not cur.rowcount:return
  obs=cur.lastrowid;name=c.get('jpName') or cid
  prev=con.execute('SELECT o.observed FROM companies c JOIN registry_observations o ON o.id=c.latest_obs WHERE c.cid=?',(cid,)).fetchone()
  if not prev or stamp>=prev[0]:con.execute('INSERT OR REPLACE INTO companies VALUES(?,?,?,?)',(cid,name,norm(name),obs))
  aliases={name};typ=str(c.get('jpTypeCode') or '')
  if typ=='5':aliases.add(('' if name.startswith('บริษัท') else 'บริษัท ')+name+('' if name.endswith('จำกัด') else ' จำกัด'))
  if typ=='3':aliases.add(('' if name.startswith('ห้างหุ้นส่วนจำกัด') else 'ห้างหุ้นส่วนจำกัด ')+name)
  if typ=='2':aliases.add(('' if name.startswith('ห้างหุ้นส่วนสามัญนิติบุคคล') else 'ห้างหุ้นส่วนสามัญนิติบุคคล ')+name)
  if typ=='7':aliases.add(('' if name.startswith('บริษัท') else 'บริษัท ')+name+('' if 'มหาชน' in name else ' จำกัด (มหาชน)'))
  con.executemany('INSERT OR IGNORE INTO aliases VALUES(?,?)',[(norm(a),cid) for a in aliases])
  for seq,r in enumerate(d.get('committees') or [],1):
   title=r.get('titleName') or '';name=' '.join(str(r.get(k) or '') for k in ['titleName','firstName','middleName','lastName']).strip()
   corporate=any(s in title for s in ['บริษัท','ห้างหุ้นส่วน','นิติบุคคล'])
   rid=str(r.get('cmtNo') or '').strip();kind='OrganizationMention' if corporate else 'PersonMention'
   related=rid if corporate and valid_id(rid) else None
   key=('org:'+rid if corporate else 'person:'+hashlib.sha256(('person:'+rid).encode()).hexdigest()) if valid_id(rid) else f'mention:{obs}:{seq}'
   con.execute('INSERT INTO registry_roles VALUES(?,?,?,?,?,?,?,?,?)',(obs,cid,key,name,kind,related,str(r.get('investAmt')) if r.get('investAmt') is not None else None,r.get('cmtTypeCode'),str(r.get('cmtSeq') or seq)))
  counters['loaded']+=1
 with ThreadPoolExecutor(max_workers=8) as pool:
  pending=[p for p in paths if str(p.relative_to(ROOT)).replace('\\','/') not in known]
  for i,(path,d,m,h,error) in enumerate(pool.map(read_registry,pending),1):
   source=str(path.relative_to(ROOT)).replace('\\','/')
   if error:registry_errors.append({'source':source,'error':error});continue
   store_registry(source,d,m,h)
   if i%2500==0:con.commit();progress('registry_import',processed=i,total=len(pending),**dict(counters))
 con.commit()
 # A backup may contain observations missing from the extracted date folders.
 known=dict(con.execute('SELECT source,content_hash FROM registry_observations'));archive=ROOT/'dbd_data-001.zip'
 archive_added=0
 if archive.exists():
  with zipfile.ZipFile(archive) as z:
   for member in z.namelist():
    if not member.endswith('/company.json'):continue
    try:
     raw=z.read(member)
     if member in known and hashlib.sha256(raw).hexdigest()==known[member]:continue
     d=json.loads(raw.decode('utf-8-sig'));mn=member.rsplit('/',1)[0]+'/manifest.json';m=json.loads(z.read(mn).decode('utf-8-sig')) if mn in z.NameToInfo else {}
     store_registry('zip:dbd_data-001.zip!'+member,d,m,hashlib.sha256(raw).hexdigest());archive_added+=1
    except Exception as ex:registry_errors.append({'source':member,'error':str(ex)})
 (OUT/'registry-errors.json').write_text(json.dumps(registry_errors,ensure_ascii=False,indent=2),encoding='utf-8')
 con.execute("INSERT OR REPLACE INTO meta VALUES('registry_complete',?)",(json.dumps({'folder_observations':len(paths),'backup_added':archive_added,'errors':len(registry_errors),'invalid_company_id':counters['invalid_company_id']}),));con.commit()

def source_id(path,member,kind,year):
 rel=str(path.relative_to(ROOT)).replace('\\','/')
 old=con.execute('SELECT id,status FROM sources WHERE path=? AND member=?',(rel,member)).fetchone()
 if old and old[1]=='complete':return None
 if old:
  sid=old[0]
  con.execute('DELETE FROM '+('contracts' if kind=='contract' else 'bids')+' WHERE source=?',(sid,));con.execute('DELETE FROM rejected WHERE source=?',(sid,));con.execute("UPDATE sources SET status='processing' WHERE id=?",(sid,))
 else:sid=con.execute("INSERT INTO sources(path,member,kind,year,status) VALUES(?,?,?,?,'processing')",(rel,member,kind,year)).lastrowid
 con.commit();return sid

for kind,folder in [('contract','Contract'),('bid','Submit (รายชื่อผู้เสนอราคา)')]:
 for archive in sorted((ROOT/'Data.go.th'/folder).glob('*.zip')):
  year=int(archive.name[:4])
  with zipfile.ZipFile(archive) as z:
   for member in z.namelist():
    if not member.lower().endswith('.csv'):continue
    sid=source_id(archive,member,kind,year)
    if sid is None:continue
    count=accepted=rejected=0;batch=[];rejects=[];started=time.time()
    with z.open(member) as stream:
     reader=csv.DictReader(io.TextIOWrapper(stream,encoding='utf-8-sig',newline=''))
     for row in reader:
      count+=1
      reason=None
      if None in row or any(v is None for v in row.values()):reason='column_count_mismatch'
      pid=str(row.get('รหัสโครงการ' if kind=='contract' else 'เลขที่โครงการ') or '').strip()
      if not reason and not re.fullmatch(r'\d{11}',pid):reason='invalid_project_id'
      if reason:rejects.append((sid,count,reason,packed(row)));rejected+=1
      elif kind=='contract':
       batch.append((pid,str(row.get('เลขประจำตัวนิติบุคคล 13 หลัก') or '').strip(),norm(row.get('ชื่อผู้ชนะการเสนอราคา')),year,sid,row.get('ลำดับ'),fingerprint(row),packed(row),row.get('ชื่อโครงการจัดซื้อจัดจ้าง'),row.get('ชื่อหน่วยงานย่อย')));accepted+=1
      else:
       batch.append((pid,row.get('ลำดับรายการพิจารณา'),row.get('ชื่อผู้เสนอราคา'),norm(row.get('ชื่อผู้เสนอราคา')),row.get('ราคาที่เสนอ (บาท)'),sid,row.get('ลำดับ'),fingerprint(row),packed(row)));accepted+=1
      if count%15000==0:
       con.executemany('INSERT INTO contracts(pid,cid,winner_key,year,source,seq,hash,raw,title,agency) VALUES(?,?,?,?,?,?,?,?,?,?)' if kind=='contract' else 'INSERT INTO bids(pid,item,name,name_key,amount,source,seq,hash,raw) VALUES(?,?,?,?,?,?,?,?,?)',batch);batch=[]
       con.executemany('INSERT INTO rejected VALUES(?,?,?,?)',rejects);rejects=[];con.commit()
      if count%150000==0:progress('csv_import',kind=kind,year=year,member=member,rows=count,rejected=rejected,seconds=round(time.time()-started))
    con.executemany('INSERT INTO contracts(pid,cid,winner_key,year,source,seq,hash,raw,title,agency) VALUES(?,?,?,?,?,?,?,?,?,?)' if kind=='contract' else 'INSERT INTO bids(pid,item,name,name_key,amount,source,seq,hash,raw) VALUES(?,?,?,?,?,?,?,?,?)',batch)
    con.executemany('INSERT INTO rejected VALUES(?,?,?,?)',rejects)
    con.execute("UPDATE sources SET status='complete',rows_read=?,accepted=?,rejected=? WHERE id=?",(count,accepted,rejected,sid));con.commit();progress('member_complete',kind=kind,year=year,member=member,rows=count,accepted=accepted,rejected=rejected)

if not con.execute("SELECT 1 FROM meta WHERE key='linked_complete'").fetchone():
 indexes=[('idx_contract_pid','contracts(pid)'),('idx_contract_cid','contracts(cid)'),('idx_contract_source','contracts(source)'),('idx_contract_winner','contracts(pid,winner_key,cid)'),('idx_bid_pid','bids(pid,name_key)'),('idx_role_cid','registry_roles(cid,obs)'),('idx_role_entity','registry_roles(entity_key)'),('idx_role_related','registry_roles(related_cid)'),('idx_comp_name','companies(name_key)'),('idx_alias_cid','aliases(cid)'),('idx_obs_cid','registry_observations(cid,observed)')]
 for name,target in indexes:progress('indexing',index=name);con.execute('CREATE INDEX IF NOT EXISTS '+name+' ON '+target);con.commit()
 progress('project_catalog')
 con.executescript('''
 DROP TABLE IF EXISTS projects;
 CREATE TABLE projects(pid TEXT PRIMARY KEY,contract_row INTEGER,contract_rows INTEGER,bid_rows INTEGER DEFAULT 0) WITHOUT ROWID;
 INSERT INTO projects SELECT pid,MAX(id),COUNT(*),0 FROM contracts GROUP BY pid;
 INSERT OR IGNORE INTO projects(pid,contract_row,contract_rows,bid_rows) SELECT pid,NULL,0,COUNT(*) FROM bids GROUP BY pid;
 DROP TABLE IF EXISTS unique_aliases;
 CREATE TABLE unique_aliases(name_key TEXT PRIMARY KEY,cid TEXT) WITHOUT ROWID;
 INSERT INTO unique_aliases SELECT name_key,MIN(cid) FROM aliases GROUP BY name_key HAVING COUNT(DISTINCT cid)=1;
 ''');con.commit()
 progress('linking_bidders')
 con.create_function('valid_id',1,valid_id,deterministic=True)
 con.execute('CREATE INDEX IF NOT EXISTS idx_bid_source ON bids(source)');con.commit()
 con.executescript("""
 DROP TABLE IF EXISTS winner_links;
 CREATE TABLE winner_links(pid TEXT,name_key TEXT,cid TEXT,candidates INTEGER,PRIMARY KEY(pid,name_key)) WITHOUT ROWID;
 INSERT INTO winner_links
 SELECT c.pid,c.winner_key,MIN(c.cid),COUNT(DISTINCT c.cid)
 FROM (SELECT DISTINCT pid,name_key FROM bids) b CROSS JOIN contracts c INDEXED BY idx_contract_winner ON c.pid=b.pid AND c.winner_key=b.name_key
 WHERE valid_id(c.cid) GROUP BY c.pid,c.winner_key;
 """);con.commit()
 for source, in con.execute("SELECT id FROM sources WHERE kind='bid' ORDER BY id").fetchall():
  con.execute("""UPDATE bids SET(linked_cid,link_method)=(
   SELECT CASE WHEN w.candidates=1 THEN w.cid WHEN w.candidates>1 THEN NULL ELSE u.cid END,
    CASE WHEN w.candidates=1 THEN 'same_project_winner_name' WHEN w.candidates>1 THEN 'ambiguous_project_winner'
    WHEN u.cid IS NOT NULL THEN 'unique_registry_name_unverified' WHEN EXISTS(SELECT 1 FROM aliases a WHERE a.name_key=bids.name_key) THEN 'ambiguous_registry_name' ELSE 'unresolved_name' END
   FROM (SELECT 1) dummy LEFT JOIN winner_links w ON w.pid=bids.pid AND w.name_key=bids.name_key
   LEFT JOIN unique_aliases u ON u.name_key=bids.name_key) WHERE source=?""",(source,))
  con.commit();progress('bid_source_linked',source=source)
 con.execute('CREATE INDEX IF NOT EXISTS idx_bid_cid ON bids(linked_cid)');con.execute('CREATE INDEX IF NOT EXISTS idx_bid_source ON bids(source)');con.commit()
 progress('summarizing')
 stats={}
 for table in ['companies','registry_observations','registry_roles','contracts','bids','projects','rejected']:stats[table]=con.execute('SELECT COUNT(*) FROM '+table).fetchone()[0]
 stats['contract_rows_with_registry']=con.execute('SELECT COUNT(*) FROM contracts t JOIN companies c ON c.cid=t.cid').fetchone()[0]
 stats['contract_rows_without_registry']=stats['contracts']-stats['contract_rows_with_registry']
 stats['companies_with_contracts']=con.execute('SELECT COUNT(*) FROM companies c WHERE EXISTS(SELECT 1 FROM contracts t WHERE t.cid=c.cid)').fetchone()[0]
 stats['projects_with_bid_data']=con.execute('SELECT COUNT(DISTINCT pid) FROM bids').fetchone()[0]
 stats['bid_only_projects']=con.execute('SELECT COUNT(*) FROM projects WHERE contract_row IS NULL').fetchone()[0]
 stats['bid_link_methods']=dict(con.execute('SELECT link_method,COUNT(*) FROM bids GROUP BY link_method'))
 stats['shared_identifier_entities_latest']=con.execute("SELECT COUNT(*) FROM (SELECT r.entity_key FROM registry_roles r JOIN companies c ON c.cid=r.cid AND c.latest_obs=r.obs WHERE r.entity_key NOT LIKE 'mention:%' GROUP BY r.entity_key HAVING COUNT(DISTINCT r.cid)>1)").fetchone()[0]
 stats['registry']=json.loads(con.execute("SELECT value FROM meta WHERE key='registry_complete'").fetchone()[0])
 stats['source_totals']=[dict(zip(['kind','year','rows_read','accepted','rejected'],r)) for r in con.execute('SELECT kind,year,SUM(rows_read),SUM(accepted),SUM(rejected) FROM sources GROUP BY kind,year')]
 stats['reject_reasons']=dict(con.execute('SELECT reason,COUNT(*) FROM rejected GROUP BY reason'))
 stats['row_semantics']='Source rows are retained; repeated project IDs and multiple contracts are not counted as distinct projects. Exact repeated rows are collapsed in project API responses using the content fingerprint, with source occurrences retained.'
 stats['limitations']=['Name-only bidder candidates remain unverified.','Masked IDs cannot link to registry by ID.','Registry snapshots do not establish historical roles at procurement time.','Person IDs are hashed internally; matching names alone are not merged.','Header mismatches and invalid project IDs are quarantined and not silently repaired.','Archive copies and nested ZIP copies are not imported twice.']
 (OUT/'summary.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
 con.execute("INSERT OR REPLACE INTO meta VALUES('linked_complete',?)",(json.dumps(stats,ensure_ascii=False),));con.commit()
 con.execute('PRAGMA wal_checkpoint(TRUNCATE)')
 progress('complete',**stats)
else:progress('complete',message='All imported sources and links already complete.')
con.close()
