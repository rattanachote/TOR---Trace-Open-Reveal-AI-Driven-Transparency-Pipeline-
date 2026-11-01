"""Bounded, evidence-backed multi-hop graphs for every explorer category."""
from __future__ import annotations

import hashlib
import json
import re
import zlib
from collections import Counter, deque

from services import identity
from services.procurement import bid_rows_of_cid
from services.namekey import v1


RELATION_LABELS = {
    "PROCURES": "หน่วยงานเจ้าของโครงการ",
    "AWARDED_TO": "ได้รับสัญญา",
    "BID_ON": "เสนอราคา",
    "HAS_ITEM": "มีรายการพิจารณา",
    "REPORTED_RELATED_PARTY": "ปรากฏเป็นผู้เกี่ยวข้องในทะเบียน",
    "IDENTIFIED_AS": "ตัวระบุชี้ไปยังนิติบุคคล",
}


class GraphBuilder:
    def __init__(self, connection, depth: int, branch: int, same_person=None):
        self.c = connection
        self.same_person = same_person or {}  # {(cid, seq): gid} for names a reviewer confirmed as one person
        self.depth = max(1, min(3, int(depth)))
        self.branch = max(3, min(48, int(branch)))
        self.node_cap = {1: 48, 2: 110, 3: 180}[self.depth]
        self.nodes: dict[str, dict] = {}
        self.edges: list[dict] = []
        self.edge_keys: set[str] = set()
        self.omitted = Counter()
        self.omitted_node_keys: set[str] = set()
        self.expanded: set[str] = set()
        self.source_cache: dict[int, dict] = {}

    def add_node(self, key, kind, label, **extra):
        if not key:
            return None
        if key not in self.nodes:
            if len(self.nodes) >= self.node_cap:
                self.omitted_node_keys.add(key)
                self.omitted["node_cap"] = len(self.omitted_node_keys)
                return None
            self.nodes[key] = {"id": key, "type": kind, "label": label or "ไม่ระบุชื่อ", **extra}
        else:
            for name, value in extra.items():
                if value is not None and self.nodes[key].get(name) in (None, ""):
                    self.nodes[key][name] = value
        return key

    def count_omitted(self, key, sql, params):
        total = int(self.c.execute(sql, params).fetchone()[0] or 0)
        if total > self.branch:
            self.omitted[key] += total - self.branch

    def add_edge(self, source, target, relation, **extra):
        if not source or not target or source not in self.nodes or target not in self.nodes:
            return
        edge = {
            "source": source,
            "target": target,
            "type": relation,
            "relation_label": RELATION_LABELS.get(relation, relation),
            **extra,
        }
        fingerprint = json.dumps(edge, ensure_ascii=False, sort_keys=True, default=str)
        if fingerprint not in self.edge_keys:
            self.edge_keys.add(fingerprint)
            self.edges.append(edge)

    def proof(self, row):
        source_id = row["source"]
        if source_id not in self.source_cache:
            src = self.c.execute("SELECT path,member FROM sources WHERE id=?", (source_id,)).fetchone()
            self.source_cache[source_id] = {"archive": src["path"], "member": src["member"]}
        return {**self.source_cache[source_id], "sequence": row["seq"]}

    @staticmethod
    def raw(row):
        return json.loads(zlib.decompress(row["raw"]))

    def agency_node(self, sub, parent, **extra):
        """Agency node; a sub-agency name shared by several parents (e.g. "คณะวิทยาศาสตร์") is qualified by its parent."""
        parent = (parent or "").strip()
        qualified = bool(parent) and v1(parent) != v1(sub) and bool(identity.agency_parents(sub))
        label = f"{sub} ({parent})" if qualified else sub
        return self.add_node(
            self.agency_key(label), "Agency", label,
            agency_name=sub, agency_parent=parent if qualified else None,
            identity_status="temporary_name_group", **extra,
        )

    @staticmethod
    def agency_key(name):
        return "agency-group:" + hashlib.sha256(name.encode()).hexdigest()[:20]

    def add_project_stub(self, pid, row=None, raw=None):
        if row is None:
            row = self.c.execute(
                "SELECT * FROM contracts WHERE pid=? ORDER BY year DESC,id DESC LIMIT 1", (pid,)
            ).fetchone()
        if row:
            raw = raw or self.raw(row)
            return self.add_node(
                "project:" + pid,
                "Project",
                raw.get("ชื่อโครงการจัดซื้อจัดจ้าง") or row["title"] or "โครงการ " + pid,
                project_id=pid,
                amount=raw.get("วงเงินงบประมาณในสัญญา (บาท)"),
                agency=raw.get("ชื่อหน่วยงานย่อย") or raw.get("ชื่อหน่วยงาน"),
                method=raw.get("ชื่อวิธีการจัดซื้อจัดจ้าง"),
                contract_number=raw.get("เลขที่สัญญา"),
                signed_date=raw.get("วันที่ลงนามในสัญญา"),
                status=raw.get("สถานะสัญญา"),
                evidence=self.proof(row),
            )
        return self.add_node(
            "project:" + pid,
            "Project",
            "โครงการ " + pid + " (มีเฉพาะข้อมูลผู้เสนอราคา)",
            project_id=pid,
            identity_status="bid_only_project",
        )

    def add_company_stub(self, cid, fallback="ไม่ระบุชื่อ", identity_status="registry_id_match"):
        registered = None
        if cid and re.fullmatch(r"\d{13}", str(cid)):
            registered = self.c.execute(
                "SELECT c.cid,c.name,c.latest_obs,o.source,o.observed FROM companies c "
                "JOIN registry_observations o ON o.id=c.latest_obs WHERE c.cid=?",
                (cid,),
            ).fetchone()
        if registered:
            return self.add_node(
                "organization:" + cid,
                "Organization",
                registered["name"],
                company_id=cid,
                dbd_source=registered["source"],
                observed=registered["observed"],
                latest_obs=registered["latest_obs"],
                identity_status=identity_status,
            )
        return None

    def expand_project(self, node_id):
        pid = node_id.split(":", 1)[1]
        rows = self.c.execute(
            "SELECT * FROM contracts WHERE pid=? ORDER BY year DESC,id DESC LIMIT ?",
            (pid, self.branch + 1),
        ).fetchall()
        bids = self.c.execute(
            "SELECT * FROM bids WHERE pid=? ORDER BY id LIMIT ?", (pid, self.branch + 1)
        ).fetchall()
        self.count_omitted("contract_records", "SELECT COUNT(*) FROM contracts WHERE pid=?", (pid,))
        self.count_omitted("bid_records", "SELECT COUNT(*) FROM bids WHERE pid=?", (pid,))
        if not rows and node_id not in self.nodes:
            self.add_project_stub(pid)
        seen_contracts = set()
        for row in rows[: self.branch]:
            if row["hash"] in seen_contracts:
                continue
            seen_contracts.add(row["hash"])
            raw = self.raw(row)
            project = self.add_project_stub(pid, row, raw)
            agency_name = raw.get("ชื่อหน่วยงานย่อย") or raw.get("ชื่อหน่วยงาน") or "ไม่ระบุหน่วยงาน"
            agency = self.agency_node(agency_name, raw.get("ชื่อหน่วยงาน"))
            self.add_edge(
                agency,
                project,
                "PROCURES",
                evidence=self.proof(row),
                confidence="medium",
                identity_basis="ชื่อหน่วยงานตรงกันแบบ exact match",
                temporal_note="อ้างอิงจากระเบียนสัญญานี้",
            )
            cid = row["cid"]
            org = self.add_company_stub(cid, raw.get("ชื่อผู้ชนะการเสนอราคา") or "ไม่ระบุผู้ชนะ")
            if not org:
                org = self.add_node(
                    "vendor:" + pid + ":" + (row["winner_key"] or str(row["id"])),
                    "UnresolvedBidder",
                    raw.get("ชื่อผู้ชนะการเสนอราคา") or "ไม่ระบุผู้ชนะ",
                    company_id=cid,
                    identity_status="registry_not_found",
                )
            self.add_edge(
                project,
                org,
                "AWARDED_TO",
                amount=raw.get("วงเงินงบประมาณในสัญญา (บาท)"),
                contract_number=raw.get("เลขที่สัญญา"),
                evidence=self.proof(row),
                confidence="high" if org.startswith("organization:") else "medium",
                identity_basis="เลขประจำตัวนิติบุคคลจากสัญญา" if org.startswith("organization:") else "ชื่อผู้ชนะจากสัญญา",
                temporal_note="สถานะ ณ ระเบียนสัญญา ไม่ยืนยันความสัมพันธ์ในอดีตอื่น",
            )
        seen_bidders = set()
        for bid in bids[: self.branch]:
            raw = self.raw(bid)
            bidder_fingerprint = (bid["name_key"], bid["item"], bid["amount"])
            if bidder_fingerprint in seen_bidders:
                continue
            seen_bidders.add(bidder_fingerprint)
            project = self.add_project_stub(pid)
            link_method = bid["link_method"] or "unresolved_name"
            verified = link_method == "same_project_winner_name"
            org = self.add_company_stub(bid["linked_cid"], bid["name"], link_method) if bid["linked_cid"] else None
            if not org:
                org = self.add_node(
                    "bidder:" + pid + ":" + (bid["name_key"] or str(bid["id"])),
                    "UnresolvedBidder",
                    bid["name"] or "ไม่ระบุผู้เสนอราคา",
                    company_id=bid["linked_cid"],
                    identity_status=link_method,
                )
            item_label = raw.get("ชื่อรายการพิจารณา") or "รายการ " + str(bid["item"] or "-")
            item = self.add_node(
                "item:" + pid + ":" + str(bid["item"] or bid["id"]),
                "TenderItem",
                item_label,
                project_id=pid,
                item_number=bid["item"],
            )
            self.add_edge(project, item, "HAS_ITEM", confidence="high", identity_basis="รหัสโครงการและลำดับรายการ")
            self.add_edge(
                org,
                project,
                "BID_ON",
                amount=bid["amount"],
                item=item_label,
                link_method=link_method,
                evidence=self.proof(bid),
                confidence="high" if verified else ("low" if "unverified" in link_method or "unresolved" in link_method else "medium"),
                identity_basis={
                    "same_project_winner_name": "ชื่อผู้เสนอราคาตรงผู้ชนะในโครงการเดียวกัน",
                    "unique_registry_name_unverified": "ชื่อทะเบียนตรงหนึ่งรายการ แต่ยังไม่ยืนยันตัวตน",
                    "unresolved_name": "ยังไม่มีตัวระบุสำหรับยืนยันชื่อ",
                    "ambiguous_project_winner": "พบผู้ชนะชื่อเดียวกันมากกว่าหนึ่งตัวระบุ",
                    "contract_name_unique_unverified": "ชื่อนี้เคยเป็นผู้ชนะสัญญาด้วยตัวระบุเพียงหนึ่งเดียว แต่ไม่ใช่ผู้ชนะในโครงการนี้ ยังไม่ยืนยันตัวตน",
                    "contract_name_dominant_unverified": "ชื่อนี้ในสัญญาส่วนใหญ่ใช้ตัวระบุเดียว (มีตัวระบุอื่นปนเล็กน้อย) ยังไม่ยืนยันตัวตน",
                    "contract_name_v2_unverified": "ชื่อตรงกับผู้ชนะสัญญาหลังตัดความต่างที่ไม่มีผลต่อชื่อ (เลขไทย ชื่อย่อ สำนักงานใหญ่) ยังไม่ยืนยันตัวตน",
                    "registry_name_v2_unverified": "ชื่อตรงกับทะเบียนหนึ่งราย หลังตัดความต่างที่ไม่มีผลต่อชื่อ ยังไม่ยืนยันตัวตน",
                }.get(link_method, link_method),
                temporal_note="อ้างอิงจากระเบียนผู้เสนอราคา",
            )

    def expand_company(self, node_id):
        cid = node_id.split(":", 1)[1]
        company = self.c.execute(
            "SELECT c.*,o.source,o.observed FROM companies c JOIN registry_observations o "
            "ON o.id=c.latest_obs WHERE c.cid=?", (cid,)
        ).fetchone()
        if not company:
            return
        org = self.add_company_stub(cid)
        roles = self.c.execute(
            "SELECT * FROM registry_roles WHERE cid=? AND obs=? LIMIT ?",
            (cid, company["latest_obs"], self.branch + 1),
        ).fetchall()
        self.count_omitted("registry_roles", "SELECT COUNT(*) FROM registry_roles WHERE cid=? AND obs=?", (cid, company["latest_obs"]))
        for role in roles[: self.branch]:
            entity_key = role["entity_key"]
            gid = self.same_person.get((cid, str(role["source_seq"]))) if entity_key.startswith("mention:") else None
            if gid:
                entity_key = "person:samename:" + gid
            status = "unresolved_mention" if entity_key.startswith("mention:") else ("confirmed_same_person" if gid else "identifier_matched_across_observations")
            related = self.add_node(
                entity_key,
                role["kind"],
                role["name"],
                entity_key=entity_key,
                related_cid=role["related_cid"],
                investAmount=role["amount"],
                dbd_source=company["source"],
                observed=company["observed"],
                identity_status=status,
            )
            self.add_edge(
                related,
                org,
                "REPORTED_RELATED_PARTY",
                raw_role_code=role["raw_role"],
                amount=role["amount"],
                evidence=company["source"],
                confidence="medium" if status != "unresolved_mention" else "low",
                identity_basis=("ผู้ตรวจทานยืนยันว่าเป็นคนเดียวกัน (ชื่อและนามสกุลตรงกัน ทะเบียนไม่มีเลขบัตร)" if gid else "ตัวระบุจากต้นทาง") if status != "unresolved_mention" else "ข้อความในทะเบียน ไม่มีตัวระบุสำหรับรวมข้ามระเบียน",
                temporal_note="ภาพทะเบียน ณ " + str(company["observed"] or "วันที่เก็บข้อมูล"),
            )
            identified = self.add_company_stub(role["related_cid"], role["name"]) if role["kind"] == "OrganizationMention" and role["related_cid"] else None
            if identified and identified != org:
                self.add_edge(
                    related,
                    identified,
                    "IDENTIFIED_AS",
                    evidence=company["source"],
                    confidence="high",
                    identity_basis="เลขทะเบียนนิติบุคคลที่มากับข้อมูลผู้เกี่ยวข้อง",
                    temporal_note="ยืนยันตัวตนนิติบุคคลได้ แต่บทบาทยังอ้างอิงภาพทะเบียน ณ วันที่เก็บข้อมูล",
                )
        awards = self.c.execute(
            "SELECT pid,MIN(id) AS rid FROM contracts WHERE cid=? GROUP BY pid ORDER BY rid LIMIT ?",
            (cid, self.branch + 1),
        ).fetchall()
        self.count_omitted("awarded_projects", "SELECT COUNT(DISTINCT pid) FROM contracts WHERE cid=?", (cid,))
        for item in awards[: self.branch]:
            row = self.c.execute("SELECT * FROM contracts WHERE id=?", (item["rid"],)).fetchone()
            project = self.add_project_stub(item["pid"], row)
            raw = self.raw(row)
            self.add_edge(
                project,
                org,
                "AWARDED_TO",
                amount=raw.get("วงเงินงบประมาณในสัญญา (บาท)"),
                evidence=self.proof(row),
                confidence="high",
                identity_basis="เลขประจำตัวนิติบุคคลในระเบียนสัญญา",
                temporal_note="อ้างอิงจากระเบียนสัญญานี้",
            )
        bids_sql, bids_n = bid_rows_of_cid(self.c)
        bid_projects = self.c.execute(
            f"SELECT pid,MIN(id) AS rid FROM ({bids_sql}) GROUP BY pid ORDER BY rid LIMIT ?",
            (*([cid] * bids_n), self.branch + 1),
        ).fetchall()
        self.count_omitted("bid_projects", f"SELECT COUNT(DISTINCT pid) FROM ({bids_sql})", tuple([cid] * bids_n))
        for item in bid_projects[: self.branch]:
            bid = self.c.execute("SELECT * FROM bids WHERE id=?", (item["rid"],)).fetchone()
            project = self.add_project_stub(item["pid"])
            self.add_edge(
                org,
                project,
                "BID_ON",
                amount=bid["amount"],
                link_method=bid["link_method"],
                evidence=self.proof(bid),
                confidence="high" if bid["link_method"] == "same_project_winner_name" else "low",
                identity_basis="เชื่อมผู้เสนอราคาด้วยวิธี " + str(bid["link_method"] or "ไม่ระบุ"),
                temporal_note="อ้างอิงจากระเบียนผู้เสนอราคา",
            )

    def same_person_roles(self, gid):
        group = identity.same_name_group(gid)
        roles = []
        for m in (group or {}).get("members", []):
            role = self.c.execute(
                "SELECT r.*,o.source,o.observed FROM registry_roles r JOIN registry_observations o ON o.id=r.obs "
                "WHERE r.cid=? AND r.obs=? AND r.source_seq=?", (m["cid"], m["obs"], m["seq"]),
            ).fetchone()
            if role:
                roles.append(role)
        return roles

    def expand_person(self, node_id):
        samename = node_id.startswith("person:samename:")
        if samename:
            roles = self.same_person_roles(node_id.rsplit(":", 1)[1])
            if len(roles) > self.branch:
                self.omitted["related_companies"] += len(roles) - self.branch
        else:
            roles = self.c.execute(
                "SELECT r.*,o.source,o.observed FROM registry_roles r JOIN companies c "
                "ON c.cid=r.cid AND c.latest_obs=r.obs JOIN registry_observations o ON o.id=r.obs "
                "WHERE r.entity_key=? LIMIT ?", (node_id, self.branch + 1)
            ).fetchall()
            self.count_omitted(
                "related_companies",
                "SELECT COUNT(*) FROM registry_roles r JOIN companies c ON c.cid=r.cid AND c.latest_obs=r.obs JOIN registry_observations o ON o.id=r.obs WHERE r.entity_key=?",
                (node_id,),
            )
        for role in roles[: self.branch]:
            center = self.add_node(
                node_id,
                role["kind"],
                role["name"],
                entity_key=node_id,
                dbd_source=role["source"],
                observed=role["observed"],
                identity_status="unresolved_mention" if node_id.startswith("mention:") else ("confirmed_same_person" if samename else "identifier_matched_across_observations"),
            )
            org = self.add_company_stub(role["cid"])
            self.add_edge(
                center,
                org,
                "REPORTED_RELATED_PARTY",
                raw_role_code=role["raw_role"],
                amount=role["amount"],
                evidence=role["source"],
                confidence="low" if node_id.startswith("mention:") else "medium",
                identity_basis=("ผู้ตรวจทานยืนยันว่าเป็นคนเดียวกัน (ชื่อและนามสกุลตรงกัน ทะเบียนไม่มีเลขบัตร)" if samename else "ตัวระบุจากต้นทาง") if not node_id.startswith("mention:") else "ข้อความในทะเบียนภายในระเบียนเดียว",
                temporal_note="ภาพทะเบียน ณ " + str(role["observed"] or "วันที่เก็บข้อมูล"),
            )
            identified = self.add_company_stub(role["related_cid"], role["name"]) if role["kind"] == "OrganizationMention" and role["related_cid"] else None
            if identified and identified != org:
                self.add_edge(
                    center,
                    identified,
                    "IDENTIFIED_AS",
                    evidence=role["source"],
                    confidence="high",
                    identity_basis="เลขทะเบียนนิติบุคคลที่มากับข้อมูลผู้เกี่ยวข้อง",
                    temporal_note="ยืนยันตัวตนนิติบุคคลได้ แต่บทบาทยังอ้างอิงภาพทะเบียน ณ วันที่เก็บข้อมูล",
                )

    def agency_rows(self, name, parent):
        """First projects of a sub-agency; when the name is shared, only those whose parent agency matches."""
        if not parent:
            rows = self.c.execute(
                "SELECT pid,MIN(id) AS rid FROM contracts WHERE agency=? GROUP BY pid ORDER BY rid LIMIT ?",
                (name, self.branch + 1),
            ).fetchall()
            self.count_omitted("agency_projects", "SELECT COUNT(DISTINCT pid) FROM contracts WHERE agency=?", (name,))
            return rows
        rows, seen = [], set()
        for r in self.c.execute("SELECT id,pid,raw FROM contracts WHERE agency=? ORDER BY id LIMIT 30000", (name,)):
            if r["pid"] in seen or v1(json.loads(zlib.decompress(r["raw"])).get("ชื่อหน่วยงาน") or "") != v1(parent):
                continue
            seen.add(r["pid"])
            if len(rows) <= self.branch:
                rows.append({"pid": r["pid"], "rid": r["id"]})
        if len(seen) > self.branch:
            self.omitted["agency_projects"] += len(seen) - self.branch
        return rows

    def expand_agency(self, node_id):
        node = self.nodes[node_id]
        name = node.get("agency_name") or node["label"]
        rows = self.agency_rows(name, node.get("agency_parent"))
        for item in rows[: self.branch]:
            row = self.c.execute("SELECT * FROM contracts WHERE id=?", (item["rid"],)).fetchone()
            project = self.add_project_stub(item["pid"], row)
            self.add_edge(
                node_id,
                project,
                "PROCURES",
                evidence=self.proof(row),
                confidence="medium",
                identity_basis="ชื่อหน่วยงานตรงกันแบบ exact match",
                temporal_note="ยังไม่มีรหัสหน่วยงานทางการสำหรับยืนยันว่าเป็นหน่วยงานเดียวกันทั้งหมด",
            )

    def expand(self, node_id):
        if node_id in self.expanded or node_id not in self.nodes:
            return
        self.expanded.add(node_id)
        node = self.nodes[node_id]
        if node["type"] == "Project":
            self.expand_project(node_id)
        elif node["type"] == "Organization" and node_id.startswith("organization:"):
            self.expand_company(node_id)
        elif node["type"] in {"PersonMention", "OrganizationMention"}:
            self.expand_person(node_id)
        elif node["type"] == "Agency":
            self.expand_agency(node_id)

    def traverse(self, center):
        queue = deque([(center, 0)])
        queued = {center}
        while queue:
            node_id, level = queue.popleft()
            self.nodes[node_id]["layer"] = min(self.nodes[node_id].get("layer", level), level)
            if level >= self.depth:
                continue
            before = set(self.nodes)
            self.expand(node_id)
            for new_id in self.nodes:
                if new_id not in before and new_id not in queued:
                    self.nodes[new_id]["layer"] = level + 1
                    queued.add(new_id)
                    queue.append((new_id, level + 1))
            for edge in self.edges:
                if edge["source"] == node_id:
                    other = edge["target"]
                elif edge["target"] == node_id:
                    other = edge["source"]
                else:
                    continue
                if other not in queued:
                    self.nodes[other]["layer"] = level + 1
                    queued.add(other)
                    queue.append((other, level + 1))

    def result(self, center, scope, value):
        counts = Counter(n["type"] for n in self.nodes.values())
        scope_notes = {
            "project": "เริ่มจากโครงการ แล้วขยายไปยังหน่วยงาน ผู้ชนะ ผู้เสนอราคา รายการพิจารณา ผู้เกี่ยวข้องในทะเบียน และโครงการอื่นของนิติบุคคล",
            "company": "เริ่มจากนิติบุคคล แล้วขยายทั้งโครงการที่ได้รับสัญญา โครงการที่เสนอราคา ผู้เกี่ยวข้องในทะเบียน หน่วยงาน และคู่แข่งในโครงการ",
            "person": "เริ่มจากผู้เกี่ยวข้อง แล้วขยายไปยังบริษัทที่ปรากฏในทะเบียน โครงการของบริษัท หน่วยงาน ผู้ชนะ และผู้เสนอราคาร่วมโครงการ",
            "agency": "เริ่มจากกลุ่มชื่อหน่วยงาน แล้วขยายไปยังโครงการ ผู้ชนะ ผู้เสนอราคา ผู้เกี่ยวข้องในทะเบียน และโครงการอื่นของนิติบุคคล",
        }
        caveats = [scope_notes[scope]]
        if scope == "agency":
            caveats.append("หน่วยงานจัดกลุ่มด้วยชื่อ exact match ชั่วคราว ยังไม่ใช่รหัสหน่วยงานทางการ")
        caveats.append("เส้นทะเบียนสะท้อนภาพ ณ วันที่เก็บข้อมูล ไม่ยืนยันบทบาทย้อนหลัง ณ วันประมูล")
        caveats.append("ชื่อที่ไม่มีตัวระบุจะไม่ถูกรวมเป็นบุคคลหรือบริษัทเดียวกันโดยอัตโนมัติ")
        return {
            "id": scope + ":" + value,
            "scope": scope,
            "center_id": center,
            "short": self.nodes[center]["label"],
            "fullData": True,
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "finding": " · ".join(caveats),
            "coverage": {
                "depth": self.depth,
                "branch_limit": self.branch,
                "max_nodes": self.node_cap,
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "expanded_nodes": len(self.expanded),
                "has_more": bool(self.omitted),
                "omitted": dict(self.omitted),
                "node_types": dict(counts),
            },
            "contract": {},
            "contracts": [],
            "bids": [],
            "amount": None,
            "bidderCount": 0,
            "signing_conditions": [],
        }


def entity_graph(c, kind, value, limit=8, depth=1, same_person=None):
    """Return a bounded graph. ``limit`` is the per-node branch cap, not a total row cap.

    ``same_person`` maps (cid, registry sequence) to a group ID for people a reviewer confirmed as one person."""
    builder = GraphBuilder(c, depth, limit, same_person)
    if kind == "project":
        if not re.fullmatch(r"\d{11}", value or ""):
            return None
        center = builder.add_project_stub(value)
        exists = builder.c.execute("SELECT 1 FROM projects WHERE pid=?", (value,)).fetchone()
        if not exists:
            return None
    elif kind == "company":
        center = builder.add_company_stub(value)
        if not center:
            return None
    elif kind == "person":
        if value.startswith("person:samename:"):
            found = builder.same_person_roles(value.rsplit(":", 1)[1])
            role = found[0] if found else None
        else:
            role = builder.c.execute(
                "SELECT r.*,o.source,o.observed FROM registry_roles r JOIN companies c "
                "ON c.cid=r.cid AND c.latest_obs=r.obs JOIN registry_observations o ON o.id=r.obs "
                "WHERE r.entity_key=? LIMIT 1", (value,)
            ).fetchone()
        if not role:
            return None
        center = builder.add_node(
            value,
            role["kind"],
            role["name"],
            entity_key=value,
            dbd_source=role["source"],
            observed=role["observed"],
            identity_status="unresolved_mention" if value.startswith("mention:") else ("confirmed_same_person" if value.startswith("person:samename:") else "identifier_matched_across_observations"),
        )
    elif kind == "agency":
        sub, _, parent = value.partition("||")  # "<sub-agency>||<parent>" opens one of several units sharing a name
        found = builder.c.execute("SELECT * FROM agency_catalog WHERE name=?", (sub,)).fetchone()
        if not found and not parent:
            m = re.fullmatch(r"(.+) \((.+)\)", value)  # the dashboard names such a unit "<sub-agency> (<parent>)"
            if m:
                sub, parent = m.group(1), m.group(2)
                found = builder.c.execute("SELECT * FROM agency_catalog WHERE name=?", (sub,)).fetchone()
        if not found:
            return None
        center = builder.agency_node(sub, parent, source_rows=None if parent else found["source_rows"])  # the catalog count covers every unit sharing the name
    else:
        return None
    builder.traverse(center)
    return builder.result(center, kind, value)
