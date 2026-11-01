"""Name keys for linking bidders and contract winners to companies.

`v1` is the key the import pipeline stores in the `*_key` columns: NFKC, case-folded, no whitespace.
`parse` / `v2` add the repairs measured in docs/LINKING-PROBLEMS-AND-FIXES.md:

  * Thai digits (๑๖๘ -> 168) and zero-width characters
  * head-office and branch notes: "(สำนักงานใหญ่)", "จำกัด สาขาขอนแก่น"
  * abbreviated legal forms: บ. / บจ. / บจก. / บมจ. / หจก. / หสน. / ห.จ.ก.
  * the legal form is returned as a separate tag, never dropped silently, so "บริษัท เอ จำกัด" and
    "ห้างหุ้นส่วนจำกัด เอ" stay different entities

Nothing here uses fuzzy matching: two names get the same v2 key only when every difference is one of the
listed cosmetic ones. Spelling variants (เอเซีย / เอเชีย) and renamed companies are left unmatched on purpose.
"""
import re, unicodedata

_DIGITS = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
_INVISIBLE = dict.fromkeys(map(ord, '​‌‍⁠﻿'))


def v1(name):
 """Key stored by the pipeline (`norm` in pipeline/link_all.py)."""
 return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(name or ''))).casefold()


def _k(text):
 return v1(text)  # patterns are written in the same normal form as the keys (sara am is decomposed)


# prefix forms, longest first; the tag says which kind of entity the name claims to be
_PREFIXES = sorted([
 ('บริษัทมหาชนจำกัด', 'pcl'), ('บริษัท', 'co'), ('บมจ.', 'pcl'), ('บมจ', 'pcl'), ('บจก.', 'co'), ('บจก', 'co'), ('บจ.', 'co'), ('บ.', 'co'),
 ('ห้างหุ้นส่วนสามัญนิติบุคคล', 'gp'), ('หสน.', 'gp'), ('หสน', 'gp'),
 ('ห้างหุ้นส่วนจำกัด', 'lp'), ('หุ้นส่วนจำกัด', 'lp'), ('ห.จ.ก.', 'lp'), ('หจก.', 'lp'), ('หจก', 'lp'),
 ('กิจการร่วมค้า', 'jv'),
], key=lambda p: -len(_k(p[0])))
_PREFIXES = [(_k(p), t) for p, t in _PREFIXES]
_SUFFIXES = [_k(s) for s in ('จำกัด(มหาชน)', 'จำกัดมหาชน', '(มหาชน)', 'จำกัด', 'จก.', 'จก')]
_HEAD_OFFICE = re.compile(_k('(สำนักงานใหญ่)') .replace('(', r'\(').replace(')', r'\)') + '|' + _k('สำนักงานใหญ่'))
_BRANCH = re.compile(r'(?<=[)ก-๙a-z0-9\.])(?:\(?' + _k('สาขา') + r'[^)]*\)?)$')
_PUNCT = re.compile(r'[\.\,\-–—_"“”\'‘’​]')


def parse(name):
 """Return (form, core): form is '' when no legal form is written, else co / pcl / lp / gp / jv."""
 k = unicodedata.normalize('NFKC', str(name or '')).translate(_DIGITS).translate(_INVISIBLE)
 k = re.sub(r'\s+', '', k).casefold()
 k = _HEAD_OFFICE.sub('', k)
 # a branch note only counts after a legal form or a closing bracket, so "สาขาวิชา…" names are left alone
 m = _BRANCH.search(k)
 if m and m.start() > 0 and (k[:m.start()].endswith(tuple(_SUFFIXES)) or k[:m.start()].endswith(')')): k = k[:m.start()]
 form = ''
 for prefix, tag in _PREFIXES:
  if k.startswith(prefix) and len(k) > len(prefix): k = k[len(prefix):]; form = tag; break
 for suffix in _SUFFIXES:
  if k.endswith(suffix) and len(k) > len(suffix):
   k = k[:-len(suffix)]
   if 'มหาชน' in suffix: form = 'pcl'
   elif not form: form = 'co'
   break
 if 'มหาชน' in k: k = k.replace(_k('(มหาชน)'), '').replace('มหาชน', ''); form = 'pcl'
 return form, _PUNCT.sub('', k)


def v2(name):
 """Single string key: '<form>:<core>' (form may be empty for shops and individuals)."""
 form, core = parse(name)
 return form + ':' + core
