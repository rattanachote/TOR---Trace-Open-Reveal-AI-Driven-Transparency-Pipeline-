import json
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from services.graphs import entity_graph

db = Path(__file__).resolve().parents[2] / "output" / "linked-data" / "procurement.sqlite3"
connection = sqlite3.connect(db)
connection.row_factory = sqlite3.Row
cases = [
    ("project", "68099218030"),
    ("company", "0365529000042"),
    ("agency", "วิทยาลัยเทคนิคยะลา"),
]
person = connection.execute(
    "SELECT entity_key FROM registry_roles WHERE entity_key NOT LIKE 'mention:%' GROUP BY entity_key HAVING COUNT(DISTINCT cid)>1 LIMIT 1"
).fetchone()
if person:
    cases.append(("person", person[0]))
results = []
for kind, key in cases:
    for depth in (1, 2, 3):
        started = time.perf_counter()
        graph = entity_graph(connection, kind, key, 6, depth)
        elapsed = time.perf_counter() - started
        assert graph and graph["center_id"] in {node["id"] for node in graph["nodes"]}
        assert all(edge["source"] in {node["id"] for node in graph["nodes"]} and edge["target"] in {node["id"] for node in graph["nodes"]} for edge in graph["edges"])
        assert all("confidence" in edge for edge in graph["edges"])
        results.append({"kind": kind, "depth": depth, "nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "seconds": round(elapsed, 3), "omitted": graph["coverage"]["omitted"]})
print(json.dumps(results, ensure_ascii=False, indent=2))
