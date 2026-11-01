"""Copy original evidence (CSV rows from the source ZIPs, DBD registry files) for download."""
import csv, io, re, zipfile
from config import ROOT

# Evidence downloads: only files the database already references, resolved inside the project folder.
def inside_root(path):
 path=path.resolve();return path if ROOT.resolve() in path.parents else None

def source_row(c,archive,member,seq):
 """Copy the exact CSV line(s) for one source record out of the original ZIP, without changing a byte."""
 if not re.fullmatch(r'\d{1,12}',seq or '') or not c.execute('SELECT 1 FROM sources WHERE path=? AND member=?',(archive,member)).fetchone():return None
 path=inside_root(ROOT/archive)
 if not path or not path.is_file():return None
 keys=(seq.encode()+b',',b'"'+seq.encode()+b'",')
 with zipfile.ZipFile(path) as z:
  info=z.getinfo(member)
  with z.open(info) as f:
   header=f.readline();columns=next(csv.reader([header.decode('utf-8-sig')]));line_no=1
   for line in f:
    line_no+=1
    if not line.startswith(keys):continue
    raw=line
    # A quoted field may contain line breaks; keep reading until the record has every column.
    for _ in range(50):
     values=next(csv.reader(io.StringIO(raw.decode('utf-8','replace'),newline='')),[])
     if len(values)>=len(columns):break
     more=f.readline()
     if not more:break
     raw+=more
    return {'archive':archive,'member':member,'sequence':seq,'line':line_no,'member_crc32':'%08x'%info.CRC,'member_size':info.file_size,'header_raw':header,'row_raw':raw,'fields':dict(zip(columns,values))}
 return None

DBD_FILES={'profile.pdf':'application/pdf','company.json':'application/json; charset=utf-8','raw.json':'application/json; charset=utf-8','manifest.json':'application/json; charset=utf-8'}
def dbd_file(c,source,name):
 if name not in DBD_FILES or not c.execute('SELECT 1 FROM registry_observations WHERE source=?',(source,)).fetchone():return None
 if source.startswith('zip:'):
  archive,member=source[4:].split('!',1);path=inside_root(ROOT/archive);member=member.rsplit('/',1)[0]+'/'+name
  if not path:return None
  with zipfile.ZipFile(path) as z:return z.read(member) if member in z.NameToInfo else None
 path=inside_root((ROOT/source).parent/name)
 return path.read_bytes() if path and path.is_file() else None
