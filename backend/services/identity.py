"""Read access to identity.sqlite3, the links added after the import (see pipeline/relink_identity.py).

The file is optional: when it is missing every function returns an empty result and the app behaves as before.
Connections are opened per call in read-only mode, so the file can be rebuilt while the server is running.
"""
import json, re, sqlite3
from config import IDENTITY
from services.namekey import v1

_META_CACHE = {}


def _open():
 if not IDENTITY.exists(): return None
 c = sqlite3.connect(IDENTITY.as_uri() + '?mode=ro', uri=True, timeout=30); c.row_factory = sqlite3.Row
 return c


def available():
 return IDENTITY.exists()


def meta():
 """Build time and counts; cached by file modification time."""
 if not IDENTITY.exists(): return {}
 stamp = IDENTITY.stat().st_mtime
 if _META_CACHE.get('stamp') != stamp:
  c = _open(); rows = dict(c.execute('SELECT key,value FROM meta').fetchall()); c.close()
  _META_CACHE.update(stamp=stamp, value={'built_at': rows.get('built_at'), 'stats': json.loads(rows.get('stats') or '{}')})
 return _META_CACHE['value']


# ───────────── agencies that share a sub-agency name ─────────────
_AGENCY_CACHE = {}


def agency_parents(sub):
 """{parent_key: rows} when this sub-agency name is used under several parent agencies, else {}."""
 if not IDENTITY.exists(): return {}
 stamp = IDENTITY.stat().st_mtime
 if _AGENCY_CACHE.get('stamp') != stamp: _AGENCY_CACHE.clear(); _AGENCY_CACHE['stamp'] = stamp
 key = v1(sub)
 if key not in _AGENCY_CACHE:
  c = _open(); row = c.execute('SELECT parents FROM agency_ambiguous WHERE sub_key=?', (key,)).fetchone(); c.close()
  _AGENCY_CACHE[key] = json.loads(row['parents']) if row else {}
 return _AGENCY_CACHE[key]


def agency_label(sub, parent):
 """Display name that tells apart units with the same name: 'คณะวิทยาศาสตร์ (มหาวิทยาลัยขอนแก่น)'."""
 return f'{sub} ({parent})' if parent and agency_parents(sub) else sub


# ───────────── people with no ID who share a name ─────────────
def same_name_groups(after='', limit=30, term=''):
 c = _open()
 if c is None: return []
 q = 'SELECT gid,name,companies FROM same_name_groups WHERE gid>? '; args = [after]
 if term: q += 'AND name_key LIKE ? '; args.append('%' + v1(term) + '%')
 groups = [dict(r) for r in c.execute(q + 'ORDER BY gid LIMIT ?', (*args, limit))]
 for g in groups:
  g['members'] = [dict(m) for m in c.execute('SELECT cid,seq,person_name,company_name,province FROM same_name_members WHERE gid=? ORDER BY company_name', (g['gid'],))]
 c.close(); return groups


def same_name_group(gid):
 if not re.fullmatch(r'[0-9a-f]{12}', gid or ''): return None
 c = _open()
 if c is None: return None
 g = c.execute('SELECT gid,name,companies FROM same_name_groups WHERE gid=?', (gid,)).fetchone()
 if not g: c.close(); return None
 out = dict(g); out['members'] = [dict(m) for m in c.execute('SELECT cid,obs,seq,person_name,company_name,province FROM same_name_members WHERE gid=?', (gid,))]
 c.close(); return out


def confirmed_same_person(reviews):
 """{(cid, seq): gid} for every group a reviewer marked 'same person' (review key 'samename|<gid>' = ok)."""
 gids = [k.split('|', 1)[1] for k, r in reviews.items() if k.startswith('samename|') and r.get('status') == 'ok']
 out = {}
 for gid in gids:
  g = same_name_group(gid)
  if g:
   for m in g['members']: out[(m['cid'], str(m['seq']))] = gid
 return out
