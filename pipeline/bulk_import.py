"""Parallel archive readers with isolated staging databases and serial merge."""
import csv,io,json,re,sqlite3,sys,time,zlib,hashlib,zipfile,unicodedata
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
csv.field_size_limit(16*1024*1024)
APP=Path(__file__).resolve().parents[1];ROOT=APP.parent;OUT=ROOT/'output/linked-data';sys.path.insert(0,str(APP/'vendor'))
try:import orjson
except ImportError:orjson=None
def dumps(x,sort=False):
 if orjson:return orjson.dumps(x,option=orjson.OPT_NON_STR_KEYS | (orjson.OPT_SORT_KEYS if sort else 0))
 return json.dumps(x,ensure_ascii=False,separators=(',',':'),sort_keys=sort).encode()
def pack(x):return zlib.compress(dumps(x),1)
def worker(args):
 path,kind,skip=args;path=Path(path);year=int(path.name[:4]);stage=OUT/f'stage-{year}-{kind}.sqlite3';c=sqlite3.connect(stage)
 c.executescript('''PRAGMA journal_mode=DELETE;PRAGMA synchronous=OFF;PRAGMA cache_size=-49152;
 CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,path TEXT,member TEXT,kind TEXT,year INTEGER,status TEXT,rows_read INTEGER,accepted INTEGER,rejected INTEGER,UNIQUE(path,member));
 CREATE TABLE IF NOT EXISTS contracts(pid TEXT,cid TEXT,winner_key TEXT,year INTEGER,source INTEGER,seq TEXT,hash BLOB,raw BLOB,title TEXT,agency TEXT);
 CREATE TABLE IF NOT EXISTS bids(pid TEXT,item TEXT,name TEXT,name_key TEXT,amount TEXT,source INTEGER,seq TEXT,hash BLOB,raw BLOB);
 CREATE TABLE IF NOT EXISTS rejected(source INTEGER,record INTEGER,reason TEXT,raw BLOB);
 ''')
 rel=str(path.relative_to(ROOT)).replace('\\','/')
 with zipfile.ZipFile(path) as z:
  for member in z.namelist():
   if not member.endswith('.csv') or member in skip:continue
   old=c.execute('SELECT id,status FROM sources WHERE path=? AND member=?',(rel,member)).fetchone()
   if old and old[1]=='complete':continue
   if old:
    sid=old[0];c.execute('DELETE FROM '+('contracts' if kind=='contract' else 'bids')+' WHERE source=?',(sid,));c.execute('DELETE FROM rejected WHERE source=?',(sid,))
   else:sid=c.execute("INSERT INTO sources(path,member,kind,year,status) VALUES(?,?,?,?,'processing')",(rel,member,kind,year)).lastrowid
   count=good=bad=0;batch=[];rejects=[];start=time.time()
   def flush():
    if batch:c.executemany('INSERT INTO contracts VALUES(?,?,?,?,?,?,?,?,?,?)' if kind=='contract' else 'INSERT INTO bids VALUES(?,?,?,?,?,?,?,?,?)',batch);batch.clear()
    if rejects:c.executemany('INSERT INTO rejected VALUES(?,?,?,?)',rejects);rejects.clear()
    c.commit()
   with z.open(member) as stream:
    reader=csv.DictReader(io.TextIOWrapper(stream,encoding='utf-8-sig',newline=''))
    for row in reader:
     count+=1;pid=str(row.get('รหัสโครงการ' if kind=='contract' else 'เลขที่โครงการ') or '').strip();reason='column_count_mismatch' if None in row or any(v is None for v in row.values()) else ('invalid_project_id' if not re.fullmatch(r'\d{11}',pid) else None)
     if reason:bad+=1;rejects.append((sid,count,reason,pack(row)))
     else:
      good+=1;h=hashlib.blake2b(dumps({k:v for k,v in row.items() if k!='ลำดับ'},True),digest_size=16).digest();raw=pack(row)
      if kind=='contract':batch.append((pid,str(row.get('เลขประจำตัวนิติบุคคล 13 หลัก') or '').strip(),re.sub(r'\s+','',unicodedata.normalize('NFKC',str(row.get('ชื่อผู้ชนะการเสนอราคา') or ''))).casefold(),year,sid,row.get('ลำดับ'),h,raw,row.get('ชื่อโครงการจัดซื้อจัดจ้าง'),row.get('ชื่อหน่วยงานย่อย')))
      else:
       name=row.get('ชื่อผู้เสนอราคา') or '';batch.append((pid,row.get('ลำดับรายการพิจารณา'),name,re.sub(r'\s+','',unicodedata.normalize('NFKC',name)).casefold(),row.get('ราคาที่เสนอ (บาท)'),sid,row.get('ลำดับ'),h,raw))
     if count%25000==0:flush()
   flush();c.execute("UPDATE sources SET status='complete',rows_read=?,accepted=?,rejected=? WHERE id=?",(count,good,bad,sid));c.commit()
   (OUT/f'worker-{year}-{kind}.json').write_text(json.dumps({'stage':'parallel_csv_import','year':year,'kind':kind,'member':member,'rows':count,'seconds':round(time.time()-start)}),encoding='utf-8')
 c.close();return str(stage)

def main():
 con=sqlite3.connect(OUT/'procurement.sqlite3');jobs=[]
 for kind,folder in [('contract','Contract'),('bid','Submit (รายชื่อผู้เสนอราคา)')]:
  for path in sorted((ROOT/'Data.go.th'/folder).glob('*.zip')):
   rel=str(path.relative_to(ROOT)).replace('\\','/');skip={r[0] for r in con.execute("SELECT member FROM sources WHERE path=? AND status='complete'",(rel,))};jobs.append((str(path),kind,skip))
 con.close();(OUT/'progress.json').write_text(json.dumps({'stage':'parallel_csv_import','archives':len(jobs),'workers':4}),encoding='utf-8')
 with ProcessPoolExecutor(max_workers=4) as pool:
  results=[f.result() for f in as_completed([pool.submit(worker,j) for j in jobs])]
 merge_stages(results)

def merge_stages(results):
 con=sqlite3.connect(OUT/'procurement.sqlite3');con.execute('PRAGMA synchronous=NORMAL');con.execute('PRAGMA cache_size=-131072')
 for stage in results:
  print('MERGING',Path(stage).name,flush=True);con.execute('ATTACH DATABASE ? AS stage',(stage,))
  for tab in ['contracts','bids','rejected']:con.execute('CREATE INDEX IF NOT EXISTS stage.idx_'+tab+'_source ON '+tab+'(source)')
  con.commit()
  for s in con.execute("SELECT id,path,member,kind,year,rows_read,accepted,rejected FROM stage.sources WHERE status='complete'").fetchall():
   local,path,member,kind,year,total,accepted,rejected=s;old=con.execute('SELECT id,status FROM sources WHERE path=? AND member=?',(path,member)).fetchone()
   if old and old[1]=='complete':continue
   if old:
    sid=old[0];con.execute('DELETE FROM '+('contracts' if kind=='contract' else 'bids')+' WHERE source=?',(sid,));con.execute('DELETE FROM rejected WHERE source=?',(sid,))
   else:sid=con.execute("INSERT INTO sources(path,member,kind,year,status) VALUES(?,?,?,?,'processing')",(path,member,kind,year)).lastrowid
   if kind=='contract':con.execute('INSERT INTO contracts(pid,cid,winner_key,year,source,seq,hash,raw,title,agency) SELECT pid,cid,winner_key,year,?,seq,hash,raw,title,agency FROM stage.contracts WHERE source=?',(sid,local))
   else:con.execute('INSERT INTO bids(pid,item,name,name_key,amount,source,seq,hash,raw) SELECT pid,item,name,name_key,amount,?,seq,hash,raw FROM stage.bids WHERE source=?',(sid,local))
   con.execute('INSERT INTO rejected SELECT ?,record,reason,raw FROM stage.rejected WHERE source=?',(sid,local));con.execute("UPDATE sources SET status='complete',rows_read=?,accepted=?,rejected=? WHERE id=?",(total,accepted,rejected,sid));con.commit()
  con.execute('DETACH DATABASE stage');print('MERGED',Path(stage).name,flush=True)
 con.execute('PRAGMA wal_checkpoint(TRUNCATE)');con.close();print('ALL ARCHIVES IMPORTED',flush=True)

if __name__=='__main__':main()
