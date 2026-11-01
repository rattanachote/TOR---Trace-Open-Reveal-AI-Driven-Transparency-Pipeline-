"""Evidence downloads: exact source rows from the original ZIPs and stored DBD registry files."""
import codecs
from api.routes import get
from services.evidence import DBD_FILES, dbd_file, source_row


@get('/api/evidence/row', 'data.view', db=True, search=True)
def evidence_row(h, q, c):
 found=source_row(c,q('archive'),q('member'),q('seq'))
 if not found:return h.send_json({'error':'ไม่พบแถวนี้ในไฟล์ต้นทางที่นำเข้า'},404)
 if q('format')=='csv':
  name=found['member'].rsplit('.',1)[0]+'-ลำดับ-'+found['sequence']+'.csv'
  # Row bytes are copied unchanged; a UTF-8 BOM is added only so Excel shows Thai text correctly.
  head=found['header_raw'] if found['header_raw'].startswith(codecs.BOM_UTF8) else codecs.BOM_UTF8+found['header_raw']
  return h.send_file(head+found['row_raw'],'text/csv; charset=utf-8',name,True)
 found.pop('header_raw');found['row_raw']=found['row_raw'].decode('utf-8','replace')
 return h.send_json(found)

@get('/api/evidence/dbd', 'data.view', db=True, search=True)
def evidence_dbd(h, q, c):
 name=q('file');raw=dbd_file(c,q('source'),name)
 if raw is None:return h.send_json({'error':'ไม่พบไฟล์ทะเบียนนี้ในเครื่อง'},404)
 cid=(c.execute('SELECT cid FROM registry_observations WHERE source=?',(q('source'),)).fetchone() or ['dbd'])[0]
 return h.send_file(raw,DBD_FILES[name],cid+'-'+name,q('download')=='1')
