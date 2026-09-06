# 📌 Project Backlog: Procurement & Social Graph Analysis System

รายการงานทั้งหมดอ้างอิงจากแผนงานโครงงานพิเศษ (Gantt Chart)

---

## 🎯 1. Project Planning & Idea
- [x] ศึกษาเรื่องที่เกี่ยวกับหัวข้อ Senior Project `@All`
- [x] วางแผนการทำงานกลุ่ม `@All`
- [x] จัดเตรียม project idea ฉบับแรก `@All`
- [x] พูดคุยกับอาจารย์เพื่อปรับแก้ project idea `@All`
- [x] ปรับแก้ project idea และส่งให้อาจารย์เซ็นต์ `@All`
- [x] ส่ง project idea `@All`

---

## 💾 2. Raw Data Storage & Ingestion
- [x] ระบุขอบเขตของข้อมูล (pdf, html, json, zip) `@Nine`
- [x] ออกแบบ structure ของ raw file storage `@Nine`
- [x] ทดสอบ upload ขึ้น storage `@Nine`
- [x] ออกแบบ format connector สำหรับแหล่งข้อมูลที่จะนำมาต่อ `@Nine`
- [x] ทำ Ingestion model เพื่อนำข้อมูลเข้ามาเก็บบน raw file storage `@Nine`
- [x] ทดสอบ Ingestion จาก pipeline e-GP `@Nine`

---

## 🕷️ 3. Data Scrapers & Collection
### e-GP Scraper
- [x] พัฒนาการค้นหารายการและเอกสารจาก e-GP `@Nine`
- [x] ทำระบบดึงข้อมูล raw data โดยไม่ทำ post-process `@Nine`
- [x] พัฒนา e-GP scraper ให้สามารถได้จำนวน throughput ต่อวันเยอะที่สุด `@Nine`
- [x] ทดสอบ upload raw data จาก e-GP ขึ้น storage `@Nine`
- [ ] เตรียม package ที่จำเป็นสำหรับนำไป deploy e-GP scraper (50%) `@Nine`
- [ ] ติดตั้ง e-GP scraper บนเครื่อง server และทดสอบการทำงาน `@Loogmoo`
- [ ] ติดตามเพื่อทดสอบข้อผิดพลาดของ e-GP scraper `@Loogmoo`

### data.go.th & e-GP RSS
- [x] พัฒนาการค้นหารายการและเอกสารจาก data.go.th & e-GP RSS `@Loogmoo`
- [x] ทำระบบดึงข้อมูล raw data จาก data.go.th & e-GP RSS `@Loogmoo`
- [x] พัฒนาให้สามารถดึงข้อมูล auto ได้ต่อเนื่อง `@Loogmoo`

### DBD Data Scraper
- [x] เตรียม tax_id ที่ได้จาก e-GP `@Neo`
- [ ] ทำ scripts search ด้วย tax_id ในการโหลดข้อมูลนิติบุคคล DBD `@Nine`
- [ ] ออกแบบ connector DBD เพื่อนำมาต่อกับ ingestion เก็บเข้า storage `@Nine`
- [ ] ทดสอบใช้งาน DBD Scraper จริง `@All`

---

## 📄 4. Proposal Report
- [ ] เริ่มทำ draft Proposal Report `@All`
- [ ] ให้อาจารย์ตรวจสอบ และแก้ไข Proposal Report `@All`
- [ ] ส่ง Proposal Report ฉบับสมบูรณ์ `@All`

---

## 🔍 5. Text Extraction & OCR
- [x] ตรวจสอบรายละเอียดต่างๆ ในไฟล์ (Text Layer, แนวตั้ง/แนวนอน) `@Neo`
- [x] คัดแยกไฟล์รูปแบบต่างๆ สำหรับกระบวนการอื่นๆ `@Neo`
- [x] ทำระบบดึงข้อความจาก text layer `@Neo`
- [ ] เลือกและทดสอบโมเดล OCR (20%) `@Neo`
- [ ] พัฒนา OCR pipeline สำหรับเอกสารสแกน `@Neo, Meredith`
- [ ] จัดการปัญหาเอกสารคุณภาพต่ำ (เอียง / ตัวอักษรเล็ก / ตาราง) `@Neo, Michael`
- [ ] ประเมิน Accuracy ของ OCR เทียบกับไฟล์ต้นฉบับ `@Neo, Rachel`

---

## 🗄️ 6. Backend, Role & Database
- [ ] ออกแบบขอบเขตสิทธิ์ของแต่ละ Role เพื่อ Publish on Production `@Nathan`
- [ ] ออกแบบ Database Schema (โครงการ / หน่วยงาน / บริษัท / บุคคล) `@Nathan`
- [ ] รวบรวมข้อมูลนิติบุคคลจากกรมพัฒนาธุรกิจการค้า (DBD) `@Meredith`
- [ ] พัฒนา LLM Prompt เพื่อดึงข้อมูลสำคัญจากข้อความ `@Michael`
- [ ] พัฒนา Entity Resolution / Fuzzy Matching `@Rachel`
- [ ] บันทึกและแปลงข้อมูลลง Database สมบูรณ์ `@All`

---

## 🕸️ 7. Social Graph
- [ ] ออกแบบโครงสร้าง Node / Edge สำหรับ Social Graph `@Nathan`
- [ ] พัฒนา Script สำหรับสร้างกราฟจากข้อมูลใน Database `@Meredith`
- [ ] พัฒนา Metric ความสัมพันธ์ (ชนะกี่โครงการ / กรรมการร่วม) `@Michael`
- [ ] ทดสอบกราฟกับข้อมูลตัวอย่าง `@Rachel`

---

## 📊 8. Dashboard & Frontend
- [ ] ออกแบบ UI/UX สำหรับ Dashboard `@Nathan`
- [ ] พัฒนาระบบค้นหาบนหน้าเว็บ `@Meredith`
- [ ] พัฒนาหน้าแสดงรายละเอียดโครงการ / นิติบุคคล `@Michael`
- [ ] พัฒนาแสดงผล Social Graph แบบ Interactive `@Rachel`
- [ ] พัฒนา API Integration เชื่อม Frontend - Backend `@All`
