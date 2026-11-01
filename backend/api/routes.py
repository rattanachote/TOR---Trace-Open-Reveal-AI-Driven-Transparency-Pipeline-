"""Route registry. Each API module registers its endpoints with @get / @post.

access:
  PUBLIC  - no account needed
  LOGIN   - any signed-in account
  '<perm>' - signed-in account whose role has that permission (e.g. 'data.view')
db:      the handler receives a read-only SQLite connection as the third argument
search:  stop the query after SEARCH_SECONDS (free-text LIKE searches can scan millions of rows)
"""
from dataclasses import dataclass
from typing import Callable, Optional

PUBLIC, LOGIN = None, 'login'
SEARCH_SECONDS = 12


@dataclass
class Route:
 fn: Callable
 access: Optional[str]
 db: bool = False
 search: bool = False


GET: dict = {}
POST: dict = {}


def get(path, access=PUBLIC, db=False, search=False):
 def register(fn):
  GET[path] = Route(fn, access, db, search); return fn
 return register


def post(path, access=PUBLIC):
 def register(fn):
  POST[path] = Route(fn, access); return fn
 return register
