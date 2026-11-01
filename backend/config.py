"""Paths and environment settings shared by the backend.

Layout (relative to the project folder that holds the raw data):
  <project>/output/linked-data/procurement.sqlite3   read-only procurement database
  <project>/Web App/frontend/                         static site served to the browser
  <project>/Web App/backend/                          this package
  <project>/Web App/vendor/                           vendored Python packages (pg8000, orjson)
  <project>/Web App/.env                              secrets for the account database
"""
import os, secrets, sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
APP = BACKEND.parent
ROOT = APP.parent
FRONTEND = APP / 'frontend'
VENDOR = APP / 'vendor'
DATA = ROOT / 'output' / 'linked-data'
DB = DATA / 'procurement.sqlite3'
ANALYTICS = DATA / 'analytics.sqlite3'   # built by pipeline/build_analytics.py
IDENTITY = DATA / 'identity.sqlite3'     # built by pipeline/relink_identity.py (links added after the import)
ENV_FILE = APP / '.env'

if str(VENDOR) not in sys.path:
 sys.path.insert(0, str(VENDOR))


def load_env():
 if ENV_FILE.exists():
  for line in ENV_FILE.read_text(encoding='utf-8').splitlines():
   if '=' in line and not line.lstrip().startswith('#'):
    k, v = line.split('=', 1); os.environ.setdefault(k.strip(), v.strip())


def setup():
 """Create .env with random secrets on first run; never overwrite existing ones."""
 if ENV_FILE.exists():
  print(f'{ENV_FILE} already exists; keeping current secrets.'); return
 ENV_FILE.write_text('# Secrets for the TOR account database. Keep this file private.\n'
  f'TOR_PG_PASSWORD={secrets.token_urlsafe(24)}\nTOR_PG_PORT=5433\n'
  f'TOR_ADMIN_USER=admin\nTOR_ADMIN_PASSWORD={secrets.token_urlsafe(12)}\n', encoding='utf-8')
 print(f'Created {ENV_FILE}. The first admin password is TOR_ADMIN_PASSWORD in that file.')
