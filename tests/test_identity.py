"""Second linking pass: matching rules, the identity file reader, and the analytics keys. No database needed.

Run from the Web App folder:  python -m unittest discover -s tests -p "test_identity.py" -v
"""
import importlib.util, json, sqlite3, sys, tempfile, unittest
from collections import Counter
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / 'backend'))

from services import identity  # noqa: E402


def load(name, path):
 spec = importlib.util.spec_from_file_location(name, path); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


relink = load('relink_identity', APP / 'pipeline' / 'relink_identity.py')
analytics = load('build_analytics', APP / 'pipeline' / 'build_analytics.py')


class Matching(unittest.TestCase):
 def test_a_single_id_is_a_unique_match(self):
  self.assertEqual(relink.pick(Counter({'0105500000001': 7})), ('0105500000001', 'unique', 7))

 def test_one_id_with_nearly_all_rows_is_dominant(self):
  self.assertEqual(relink.pick(Counter({'0105500000001': 561533, '0994000000001': 5})), ('0105500000001', 'dominant', 561533))

 def test_no_dominant_id_means_no_link(self):
  self.assertIsNone(relink.pick(Counter({'0105500000001': 60, '0105500000002': 40})))

 def test_dominance_needs_enough_rows(self):
  # 10 rows against 1 is dominant by share but too thin to trust
  self.assertIsNone(relink.pick(Counter({'0105500000001': 10, '0105500000002': 1})))

 def test_checksum(self):
  self.assertTrue(relink.valid_id('0105539106911'))
  self.assertFalse(relink.valid_id('0105539106912'))
  self.assertFalse(relink.valid_id('010553910xxxx'))


class AnalyticsKeys(unittest.TestCase):
 def test_valid_id_is_the_key(self):
  self.assertEqual(analytics.winner_key('0105539106911', 'ก'), '0105539106911')

 def test_masked_id_is_hashed_and_never_shown(self):
  key = analytics.winner_key('310090212xxxx', 'นายสมชายใจดี')
  self.assertTrue(key.startswith('masked:')); self.assertNotIn('310090212', key); self.assertTrue(key.endswith(':นายสมชายใจดี'))

 def test_same_name_different_masked_prefix_stays_apart(self):
  self.assertNotEqual(analytics.winner_key('310090212xxxx', 'นายสมชายใจดี'), analytics.winner_key('150010099xxxx', 'นายสมชายใจดี'))
  self.assertEqual(analytics.winner_key('310090212xxxx', 'นายสมชายใจดี'), analytics.winner_key('310090212XXXX', 'นายสมชายใจดี'))

 def test_no_id_falls_back_to_the_name(self):
  self.assertEqual(analytics.winner_key('', 'ร้านก'), 'name:ร้านก')

 def test_shared_sub_agency_name_is_qualified_by_its_parent(self):
  shared = {identity.v1('คณะวิทยาศาสตร์')}
  self.assertEqual(analytics.agency_key('คณะวิทยาศาสตร์', 'มหาวิทยาลัยขอนแก่น', shared), 'คณะวิทยาศาสตร์ (มหาวิทยาลัยขอนแก่น)')
  self.assertEqual(analytics.agency_key('โรงพยาบาลตากสิน', 'กรุงเทพมหานคร', shared), 'โรงพยาบาลตากสิน')

 def test_a_sub_agency_equal_to_its_parent_is_not_qualified(self):
  shared = {identity.v1('เทศบาลนคร')}
  self.assertEqual(analytics.agency_key('เทศบาลนคร', 'เทศบาล นคร', shared), 'เทศบาลนคร')

 def test_spacing_is_collapsed(self):
  self.assertEqual(analytics.agency_key('คณะศึกษาศาสตร์ ', '', set()), 'คณะศึกษาศาสตร์')
  self.assertEqual(analytics.agency_key('กอง  นโยบาย', '', set()), 'กอง นโยบาย')


class IdentityFile(unittest.TestCase):
 def setUp(self):
  self.dir = tempfile.TemporaryDirectory(); self.path = Path(self.dir.name) / 'identity.sqlite3'
  c = sqlite3.connect(self.path)
  c.executescript('''CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
   CREATE TABLE agency_ambiguous(sub_key TEXT PRIMARY KEY,sub TEXT,rows INTEGER,parents TEXT);
   CREATE TABLE same_name_groups(gid TEXT PRIMARY KEY,name_key TEXT,name TEXT,companies INTEGER);
   CREATE TABLE same_name_members(gid TEXT,cid TEXT,obs INTEGER,seq TEXT,person_name TEXT,company_name TEXT,province TEXT);''')
  c.execute('INSERT INTO meta VALUES(?,?)', ('built_at', '2026-10-31T10:00:00')); c.execute('INSERT INTO meta VALUES(?,?)', ('stats', '{"bids":{"linked_added":3}}'))
  c.execute('INSERT INTO agency_ambiguous VALUES(?,?,?,?)', (identity.v1('คณะวิทยาศาสตร์'), 'คณะวิทยาศาสตร์', 90, json.dumps({'a': 60, 'b': 30})))
  c.execute('INSERT INTO same_name_groups VALUES(?,?,?,?)', ('0123456789ab', 'สมชายใจดี', 'นาย สมชาย ใจดี', 2))
  c.executemany('INSERT INTO same_name_members VALUES(?,?,?,?,?,?,?)', [
   ('0123456789ab', '0105500000001', 11, '2', 'นาย สมชาย ใจดี', 'บริษัท เอ จำกัด', 'ขอนแก่น'),
   ('0123456789ab', '0105500000002', 12, '3', 'นาย สมชาย  ใจดี', 'บริษัท บี จำกัด', 'ระยอง')])
  c.commit(); c.close()
  self.original = identity.IDENTITY; identity.IDENTITY = self.path; identity._AGENCY_CACHE.clear(); identity._META_CACHE.clear()

 def tearDown(self):
  identity.IDENTITY = self.original; self.dir.cleanup()

 def test_agency_parents(self):
  self.assertEqual(identity.agency_parents('คณะ วิทยาศาสตร์'), {'a': 60, 'b': 30})  # spacing does not matter
  self.assertEqual(identity.agency_parents('โรงพยาบาลตากสิน'), {})

 def test_same_name_groups_list_members(self):
  groups = identity.same_name_groups()
  self.assertEqual(len(groups), 1); self.assertEqual(len(groups[0]['members']), 2)
  self.assertEqual(identity.same_name_groups(term='ใจดี')[0]['gid'], '0123456789ab')
  self.assertEqual(identity.same_name_groups(term='ไม่มีชื่อนี้'), [])

 def test_only_groups_marked_ok_count_as_one_person(self):
  confirmed = identity.confirmed_same_person({'samename|0123456789ab': {'status': 'ok'}, 'a|b|c': {'status': 'ok'}})
  self.assertEqual(confirmed, {('0105500000001', '2'): '0123456789ab', ('0105500000002', '3'): '0123456789ab'})
  self.assertEqual(identity.confirmed_same_person({'samename|0123456789ab': {'status': 'no'}}), {})

 def test_group_id_is_validated(self):
  self.assertIsNone(identity.same_name_group("0123'; DROP TABLE x;--"))

 def test_meta(self):
  self.assertEqual(identity.meta()['built_at'], '2026-10-31T10:00:00')

 def test_missing_file_gives_empty_results(self):
  identity.IDENTITY = Path(self.dir.name) / 'absent.sqlite3'; identity._AGENCY_CACHE.clear()
  self.assertFalse(identity.available()); self.assertEqual(identity.agency_parents('x'), {}); self.assertEqual(identity.same_name_groups(), [])
  self.assertEqual(identity.confirmed_same_person({'samename|0123456789ab': {'status': 'ok'}}), {}); self.assertEqual(identity.meta(), {})


if __name__ == '__main__':
 unittest.main()
