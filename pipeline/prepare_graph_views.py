"""Build a name-group catalog for agency browsing; names are not official IDs."""
import sqlite3
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with sqlite3.connect(root/'output/linked-data/procurement.sqlite3',timeout=120) as c:
 c.execute('PRAGMA cache_size=-131072')
 print('Preparing agency name index',flush=True)
 c.execute('CREATE INDEX IF NOT EXISTS idx_contract_agency ON contracts(agency)')
 c.execute('CREATE TABLE IF NOT EXISTS agency_catalog(name TEXT PRIMARY KEY,first_row INTEGER,source_rows INTEGER) WITHOUT ROWID')
 if not c.execute('SELECT 1 FROM agency_catalog LIMIT 1').fetchone():
  c.execute("INSERT INTO agency_catalog SELECT agency,MIN(id),COUNT(*) FROM contracts WHERE agency IS NOT NULL AND agency!='' GROUP BY agency")
 print('Agency name groups:',c.execute('SELECT COUNT(*) FROM agency_catalog').fetchone()[0],flush=True)
