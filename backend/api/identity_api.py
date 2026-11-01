"""Leads for reviewers that come from the second linking pass (identity.sqlite3)."""
from api.routes import get
from services import identity


@get('/api/review/same-name', 'data.view')
def same_name(h, q):
 """People named only in the DBD registry (no ID) who appear in several companies. Never merged automatically."""
 limit = max(1, min(50, int(q('limit', '20')))); after = q('after'); term = q('q').strip()
 rows = identity.same_name_groups(after, limit + 1, term); page = rows[:limit]
 return h.send_json({'items': page, 'next': page[-1]['gid'] if len(rows) > limit else None, 'built_at': identity.meta().get('built_at'),
                     'note': 'ชื่อและนามสกุลตรงกัน แต่ทะเบียนไม่มีเลขบัตร จึงยังไม่ใช่การยืนยันว่าเป็นคนเดียวกัน'})
