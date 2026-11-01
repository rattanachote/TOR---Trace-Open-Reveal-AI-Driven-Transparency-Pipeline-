"""Unit tests that need no database: search normalisation, publication filter, route permissions.

Run from the Web App folder:  python -m unittest discover -s tests -v
"""
import re, sys, unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'backend'))

import config  # noqa: E402,F401
from services.textnorm import compact, like, like_any, tokens  # noqa: E402
from services.snapshot import edge_key, filter_public  # noqa: E402
from api import routes, handler  # noqa: E402,F401  (importing handler registers every route)


class TextNorm(unittest.TestCase):
 def test_any_spacing_matches(self):
  self.assertEqual(like('ยงยุทธ ปวิตรปก'), '%ยงยุทธ%ปวิตรปก%')
  self.assertEqual(like('ยงยุทธ   ปวิตรปก'), '%ยงยุทธ%ปวิตรปก%')

 def test_titles_and_legal_forms_removed(self):
  self.assertEqual(tokens('นาย ยงยุทธ'), ['ยงยุทธ'])
  self.assertEqual(tokens('นายยงยุทธ'), ['ยงยุทธ'])
  self.assertEqual(tokens('นางสาวทิพวัล'), ['ทิพวัล'])
  self.assertEqual(compact('บริษัท เฉลิมศักดิ์ เทรดดิ้ง จำกัด'), 'เฉลิมศักดิ์เทรดดิ้ง')

 def test_only_a_title_keeps_the_term(self):
  self.assertEqual(like('บริษัท'), '%บริษัท%')

 def test_like_wildcards_are_neutralised(self):
  self.assertNotIn('_', like('รถ_โดยสาร')); self.assertEqual(like('100%'), '%100%')

 def test_pattern_matches_double_spaced_source(self):
  pattern = like('นาย ยงยุทธ ปวิตรปก').replace('%', '.*')
  self.assertRegex('นาย ยงยุทธ  ปวิตรปก', pattern)

 def test_thai_and_arabic_digits_find_each_other(self):
  self.assertEqual(like('กิจธนาทรัพย์๑๖๘'), like('กิจธนาทรัพย์168'))
  sql, args = like_any('name_key', '%' + compact('กิจธนาทรัพย์168') + '%')
  self.assertEqual(args, ['%กิจธนาทรัพย์168%', '%กิจธนาทรัพย์๑๖๘%']); self.assertIn(' OR ', sql)
  self.assertEqual(like_any('name_key', '%ยงยุทธ%'), ('name_key LIKE ?', ['%ยงยุทธ%']))

 def test_attached_company_abbreviations_are_dropped_from_the_search(self):
  self.assertEqual(tokens('บจก.โกทูเทค'), ['โกทูเทค']); self.assertEqual(tokens('หจก.สุธาวดี คอนสตรัคชั่น'), ['สุธาวดี', 'คอนสตรัคชั่น'])
  self.assertEqual(tokens('บจ.'), ['บจ.'])  # an abbreviation on its own is kept


class PublicationFilter(unittest.TestCase):
 def setUp(self):
  ev = {'archive': 'a.zip', 'member': 'm.csv', 'sequence': '7'}
  self.nodes = {i: {'id': i} for i in ('c', 'p1', 'p2', 'org', 'agency', 'island')}
  self.high = {'source': 'p1', 'target': 'c', 'type': 'AWARDED_TO', 'confidence': 'high', 'evidence': ev}
  self.medium = {'source': 'agency', 'target': 'p1', 'type': 'PROCURES', 'confidence': 'medium', 'evidence': ev}
  self.rejected = {'source': 'org', 'target': 'c', 'type': 'BID_ON', 'confidence': 'low', 'evidence': ev, 'item': 'x'}
  self.unreviewed = {'source': 'p2', 'target': 'c', 'type': 'BID_ON', 'confidence': 'low', 'evidence': ev}
  self.edges = [self.high, self.medium, self.rejected, self.unreviewed]

 def test_edge_key_matches_frontend_format(self):
  # tor.js: [source, type, target, evidence?.sequence ?? '', item ?? ''].join('|')
  self.assertEqual(edge_key(self.high), 'p1|AWARDED_TO|c|7|')
  self.assertEqual(edge_key(self.rejected), 'org|BID_ON|c|7|x')
  self.assertEqual(edge_key({'source': 'a', 'target': 'b', 'type': 'T', 'evidence': 'dbd/path.json'}), 'a|T|b||')

 def test_only_confirmed_or_high_confidence_edges_survive(self):
  reviews = {edge_key(self.medium): {'status': 'ok', 'reviewer': 'R', 'at': 't'}, edge_key(self.rejected): {'status': 'no'}}
  nodes, edges, stats = filter_public('c', self.nodes, self.edges, reviews)
  self.assertEqual({e['type'] for e in edges}, {'AWARDED_TO', 'PROCURES'})
  self.assertEqual(stats['excluded_unreviewed'], 1); self.assertEqual(stats['excluded_rejected'], 1)
  self.assertEqual({n['id'] for n in nodes}, {'c', 'p1', 'agency'})  # org, p2 and the island drop out

 def test_rejected_high_confidence_edge_is_removed(self):
  _, edges, _ = filter_public('c', self.nodes, [self.high], {edge_key(self.high): {'status': 'no'}})
  self.assertEqual(edges, [])


class RoutePermissions(unittest.TestCase):
 PUBLIC = {'/api/stats', '/api/health', '/api/auth/me', '/api/public/cases', '/api/public/case',
           '/api/public/evidence/row', '/api/public/evidence/dbd', '/api/auth/login', '/api/auth/register',
           '/api/auth/logout', '/api/public/corrections'}

 def all_routes(self):
  return {**{('GET', p): r for p, r in routes.GET.items()}, **{('POST', p): r for p, r in routes.POST.items()}}

 def test_public_routes_are_exactly_the_expected_set(self):
  public = {p for (_, p), r in self.all_routes().items() if r.access is routes.PUBLIC}
  self.assertEqual(public, self.PUBLIC)

 def test_admin_routes_need_manage_permissions(self):
  for (_, path), r in self.all_routes().items():
   if path.startswith('/api/admin/users'): self.assertEqual(r.access, 'users.manage', path)
   if path.startswith('/api/admin/roles'): self.assertEqual(r.access, 'roles.manage', path)

 def test_publishing_and_confirming_need_review_permission(self):
  for path in ('/api/reviews', '/api/reviews/bulk', '/api/cases/publish', '/api/cases/reject', '/api/cases/withdraw', '/api/corrections/resolve'):
   self.assertEqual(routes.POST[path].access, 'review.confirm', path)

 def test_data_routes_need_data_view(self):
  for path in ('/api/projects', '/api/companies', '/api/people', '/api/entity-graph', '/api/evidence/row', '/api/dashboard/overview', '/api/indicators', '/api/review/same-name'):
   self.assertEqual(routes.GET[path].access, 'data.view', path)

 def test_route_paths_are_well_formed(self):
  for (_, path) in self.all_routes():
   self.assertRegex(path, r'^/api(/[a-z-]+)+$')


if __name__ == '__main__':
 unittest.main()
