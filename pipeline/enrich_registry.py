"""Preserve signing conditions as sourced text, without inventing signatory edges."""
import json,sqlite3,sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/linked-data'
def read(row):
 obs,cid,source=row
 try:
  d=json.loads((ROOT/source).read_text(encoding='utf-8-sig'))
  return [(obs,cid,str(s.get('signSeq') or i),s.get('signDescription') or '') for i,s in enumerate(d.get('sign_committees') or [],1)]
 except Exception:return []
def main():
 c=sqlite3.connect(OUT/'procurement.sqlite3',timeout=60)
 c.execute('CREATE TABLE IF NOT EXISTS signing_conditions(obs INTEGER,cid TEXT,seq TEXT,description TEXT,PRIMARY KEY(obs,seq))')
 rows=c.execute("SELECT id,cid,source FROM registry_observations WHERE source NOT LIKE 'zip:%'").fetchall()
 with ThreadPoolExecutor(max_workers=8) as pool:
  for i,result in enumerate(pool.map(read,rows),1):
   c.executemany('INSERT OR REPLACE INTO signing_conditions VALUES(?,?,?,?)',result)
   if i%5000==0:c.commit()
 c.execute('CREATE INDEX IF NOT EXISTS idx_sign_cid ON signing_conditions(cid,obs)');c.commit()
 print(json.dumps({'signing_condition_records':c.execute('SELECT COUNT(*) FROM signing_conditions').fetchone()[0]}));c.close()
if __name__=='__main__':main()
