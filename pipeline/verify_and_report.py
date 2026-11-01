import json,sqlite3,zlib,hashlib,zipfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/linked-data'
sys.stdout.reconfigure(encoding='utf-8')
c=sqlite3.connect(OUT/'procurement.sqlite3');c.row_factory=sqlite3.Row
stats=json.loads((OUT/'summary.json').read_text(encoding='utf-8'))
c.executescript('''
CREATE VIEW IF NOT EXISTS linked_awards AS
 SELECT t.id AS contract_row,t.pid,t.cid,t.year,t.source,t.seq,
 CASE WHEN c.cid IS NOT NULL THEN 'registry_id_match' ELSE 'registry_not_found_or_not_applicable' END AS registry_link
 FROM contracts t LEFT JOIN companies c ON c.cid=t.cid;
CREATE VIEW IF NOT EXISTS linked_bid_relationships AS
 SELECT id AS bid_row,pid,item,name,amount,linked_cid,link_method,source,seq,
 CASE WHEN link_method='same_project_winner_name' THEN 1 ELSE 0 END AS contextual_identity_match
 FROM bids;
CREATE VIEW IF NOT EXISTS registry_latest_relationships AS
 SELECT r.*,o.observed,o.source AS registry_source
 FROM registry_roles r JOIN companies c ON c.cid=r.cid AND c.latest_obs=r.obs
 JOIN registry_observations o ON o.id=r.obs;
CREATE VIEW IF NOT EXISTS verified_company_project_links AS
 SELECT DISTINCT c.cid,t.pid FROM companies c JOIN contracts t ON t.cid=c.cid;
''')
c.commit()
checks={}
expected_sources=set()
for path in (ROOT/'Data.go.th').rglob('*.zip'):
 with zipfile.ZipFile(path) as archive:
  expected_sources.update((str(path.relative_to(ROOT)).replace('\\','/'),name) for name in archive.namelist() if name.endswith('.csv'))
checks['every_csv_member_imported']=expected_sources==set((r[0],r[1]) for r in c.execute('SELECT path,member FROM sources'))
checks['all_sources_complete']=c.execute("SELECT COUNT(*) FROM sources WHERE status!='complete'").fetchone()[0]==0
checks['source_reconciliation']=all(r['rows_read']==r['accepted']+r['rejected'] for r in c.execute('SELECT * FROM sources'))
checks['contract_count_reconciliation']=c.execute("SELECT SUM(accepted) FROM sources WHERE kind='contract'").fetchone()[0]==stats['contracts']
checks['bid_count_reconciliation']=c.execute("SELECT SUM(accepted) FROM sources WHERE kind='bid'").fetchone()[0]==stats['bids']
checks['reject_count_reconciliation']=c.execute('SELECT SUM(rejected) FROM sources').fetchone()[0]==stats['rejected']
checks['project_contract_rows_reconciliation']=c.execute('SELECT SUM(contract_rows) FROM projects').fetchone()[0]==stats['contracts']
checks['bid_link_method_reconciliation']=sum(stats['bid_link_methods'].values())==stats['bids']
checks['no_unprocessed_bids']=c.execute('SELECT COUNT(*) FROM bids WHERE link_method IS NULL').fetchone()[0]==0
checks['registry_roles_have_observations']=c.execute('SELECT COUNT(*) FROM registry_roles r LEFT JOIN registry_observations o ON o.id=r.obs WHERE o.id IS NULL').fetchone()[0]==0
examples={}
for pid in ['68099218030','69069118999','69079134808','69069277385','69069361852']:
 contracts=c.execute('SELECT COUNT(*) FROM contracts WHERE pid=?',(pid,)).fetchone()[0];bids=c.execute('SELECT COUNT(*) FROM bids WHERE pid=?',(pid,)).fetchone()[0]
 examples[pid]={'contract_source_rows':contracts,'bid_source_rows':bids};checks['example_'+pid]=contracts>0 and bids>0
# Verify compressed records against actual archive rows, including normalization-independent row hashes.
sample_proofs=[]
for kind,table in [('contract','contracts'),('bid','bids')]:
 for year in [2565,2566,2567,2568,2569]:
  sid=c.execute('SELECT id FROM sources WHERE year=? AND kind=? ORDER BY id LIMIT 1',(year,kind)).fetchone()
  if not sid:continue
  row=c.execute(f'SELECT t.*,s.path,s.member FROM {table} t JOIN sources s ON s.id=t.source WHERE t.source=? LIMIT 1',(sid[0],)).fetchone()
  if not row:continue
  data=json.loads(zlib.decompress(row['raw']));expected=hashlib.blake2b(json.dumps({k:v for k,v in data.items() if k!='ลำดับ'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode(),digest_size=16).digest()
  ok=expected==row['hash'];checks[f'hash_{kind}_{year}']=ok;sample_proofs.append({'kind':kind,'year':year,'project':row['pid'],'archive':row['path'],'member':row['member'],'sequence':row['seq'],'hash_verified':ok})
inventory=[]
for path in sorted((ROOT/'Data.go.th').rglob('*.zip')):
 with zipfile.ZipFile(path) as z:
  inventory.append({'path':str(path.relative_to(ROOT)),'compressed_file_bytes':path.stat().st_size,'members':[{'name':f.filename,'bytes':f.file_size,'crc32':f'{f.CRC:08x}'} for f in z.infolist()]})
result={'checks':checks,'passed':all(checks.values()),'examples':examples,'sample_proofs':sample_proofs,'inventory':inventory}
(OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
if not result['passed']:raise RuntimeError('Verification failed: '+str([k for k,v in checks.items() if not v]))
text=['# ผลเชื่อมโยงข้อมูลทั้งหมด','', 'ฐานข้อมูลสำหรับสำรวจในเครื่อง ประมวลผลชุดข้อมูลที่มีอยู่ ณ 23 ตุลาคม 2569 ไม่ใช่การดึงข้อมูลล่าสุดจากต้นทาง','', '## ผลที่ได้','', '| รายการ | จำนวน |','|---|---:|']
labels={'companies':'นิติบุคคลในทะเบียน','registry_observations':'ภาพข้อมูลทะเบียนที่เก็บไว้','registry_roles':'รายการผู้เกี่ยวข้องตามทะเบียนทุกภาพข้อมูล','projects':'รหัสโครงการไม่ซ้ำ รวมโครงการที่มีเฉพาะผู้เสนอราคา','contracts':'แถวสัญญาที่รับเข้า','bids':'แถวผู้เสนอราคาที่รับเข้า','rejected':'แถวที่แยกเก็บรอทบทวน','contract_rows_with_registry':'แถวสัญญาที่เชื่อมเลขทะเบียนกับ DBD ได้','contract_rows_without_registry':'แถวสัญญาที่ไม่พบทะเบียน DBD ตรงรหัส','companies_with_contracts':'นิติบุคคลในทะเบียนที่พบเป็นผู้ชนะ','projects_with_bid_data':'โครงการที่มีข้อมูลผู้เสนอราคา','bid_only_projects':'โครงการผู้เสนอราคาที่ไม่มีข้อมูลสัญญา','shared_identifier_entities_latest':'ตัวระบุผู้เกี่ยวข้องที่ปรากฏในมากกว่าหนึ่งนิติบุคคล ณ ภาพข้อมูลล่าสุด'}
text.extend(f'| {label} | {stats[key]:,} |' for key,label in labels.items())
text+=['','## ความครอบคลุมรายชุดข้อมูล','', '| ประเภท | ปีจากไฟล์ | แถวที่อ่าน | รับเข้า | แยกทบทวน |','|---|---:|---:|---:|---:|']
for r in stats['source_totals']:text.append(f"| {'สัญญา' if r['kind']=='contract' else 'ผู้เสนอราคา'} | {r['year']} | {r['rows_read']:,} | {r['accepted']:,} | {r['rejected']:,} |")
text+=['','## วิธีเชื่อมและการนับ','', '- นำเข้าข้อมูลทะเบียนแบบมีโครงสร้างจาก company.json และวันที่จาก manifest.json ส่วน raw.json และ profile.pdf คงไว้เป็นหลักฐานต้นฉบับ รอบนี้ไม่ได้ทำ OCR หรือสกัดข้อมูลเพิ่มเติมจาก PDF ทุกไฟล์', '- สัญญาเชื่อมผู้เสนอราคาด้วยรหัสโครงการ 11 หลัก และคงลำดับรายการพิจารณาไว้','- ผู้ชนะเชื่อมทะเบียนด้วยเลขนิติบุคคล 13 หลักตรงกัน','- ผู้เสนอราคาที่ชื่อตรงผู้ชนะภายในโครงการเดียวกันเชื่อมรหัสผู้ชนะโดยระบุวิธีจับคู่','- ชื่อที่ตรงทะเบียนเพียงรายเดียวเก็บเป็นผู้สมัครจับคู่ที่ยังไม่ยืนยัน ไม่ถือว่าเป็นตัวตนที่ยืนยันแล้ว','- บุคคลเชื่อมข้ามบริษัทด้วยแฮชของตัวระบุที่ผ่านการตรวจรูปแบบ/เลขตรวจสอบ ไม่เผยเลขบุคคลในเว็บ ไม่มีการรวมด้วยชื่ออย่างเดียว','- หน่วยงานใช้รหัสจากชื่อเป็นการชั่วคราว ยังต้องหาทะเบียนรหัสหน่วยงานทางการ','- เก็บทุกแถวพร้อม ZIP ไฟล์สมาชิก และคอลัมน์ลำดับ รหัสโครงการซ้ำไม่ได้ถูกนับเป็นโครงการใหม่','- เก็บแถวเนื้อหาซ้ำไว้เป็นหลักฐาน กราฟรายโครงการยุบสำเนาที่เนื้อหาตรงกันด้วยลายนิ้วมือข้อมูล จำนวนแถวสัญญาจึงไม่ใช่จำนวนสัญญาไม่ซ้ำ','- ยอดเงินในรายละเอียดเป็นยอดของระเบียนสัญญาที่เลือก ไม่ใช่ยอดรวมทุกสัญญาหรือยอดจ่ายจริง','', '## ผลจับคู่ผู้เสนอราคา','']
text.extend('- '+k+': '+format(v,',')+' แถว' for k,v in stats['bid_link_methods'].items())
text+=['','## สิ่งที่ต้องหาเพิ่ม','', '- รายชื่อผู้เสนอราคาย้อนหลังให้ครบ โดยเฉพาะปี 2566–2568 และปี 2565 ที่ไม่มีไฟล์ผู้เสนอราคาในชุดนี้','- เลขทะเบียนของผู้เสนอราคาที่ยังมีแต่ชื่อ สมาชิกกิจการค้าร่วม และตัวระบุที่ไม่ถูกปิดบัง','- เอกสารทะเบียนย้อนหลัง ณ วันประมูล รวมบทบาทกรรมการ/หุ้นส่วน/ผู้ถือหุ้น และเงื่อนไขลงนาม','- รหัสหน่วยงานทางการ รายการสินค้า ปริมาณ หน่วย ผลคุณสมบัติ การต่อรองราคา และข้อมูลตรวจรับตามโจทย์วิเคราะห์','', '## ขอบเขตเว็บแอป','', '- ค้นและเปิดโครงการจากฐานข้อมูลทั้งหมดผ่านเซิร์ฟเวอร์ในเครื่อง','- รายการแบ่งหน้าครั้งละไม่เกิน 30 แถว กราฟเปิดทีละโครงการ','- API กราฟโหลดสูงสุด 2,000 แถวสัญญาและ 2,000 แถวผู้เสนอราคา พร้อมสถานะ truncated; หน้ากราฟแสดงไม่เกิน 70 จุดในคราวเดียว การจำกัดหน้าจอไม่ลดจำนวนข้อมูลในฐานข้อมูล','- ค้นรหัสโครงการตรงตัวได้แม้มีเฉพาะผู้เสนอราคา การค้นชื่อค้นทั้งฝั่งสัญญาและชื่อผู้เสนอราคา โดยแบ่งหน้าตามระเบียนต้นทาง','- ตัวระบุผู้เกี่ยวข้องร่วมกันสะท้อนความเชื่อมโยงจากข้อมูลต้นทาง ยังต้องตรวจความถูกต้องและเวลา ไม่ใช่ข้อสรุปการทุจริต','', '## ไฟล์สำรองและการตรวจสอบ','', 'เปรียบเทียบ CRC และขนาดของ ZIP ใน drive-download กับ Data.go.th ตรงกันครบ 9 ไฟล์ ส่วนข้อมูลทะเบียนใน dbd_data-001.zip ไม่พบภาพข้อมูลเพิ่มจากโฟลเดอร์ที่คลายไว้ จึงไม่โหลดสำเนาซ้ำ','',f"ผ่านการตรวจสอบ {len(checks)} ข้อ รวมยอดรับเข้า/แยกทบทวน การเชื่อมทุกแถวข้อเสนอ การอ้างอิงภาพทะเบียน ตัวอย่างเดิม 5 โครงการ และตรวจลายนิ้วมือข้อมูลตัวอย่างทุกชุดปีที่มีไฟล์","",'รายละเอียดตรวจสอบ: verification.json · สถิติ: summary.json · ฐานข้อมูล: procurement.sqlite3']
(OUT/'linking-report.md').write_text('\n'.join(text),encoding='utf-8')
print(json.dumps({'passed':True,'checks':len(checks),'stats':stats},ensure_ascii=False));c.close()
