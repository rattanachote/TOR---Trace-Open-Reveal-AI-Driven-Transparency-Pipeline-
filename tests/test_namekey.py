"""Name-key rules, with the real variants found in the data (docs/LINKING-PROBLEMS-AND-FIXES.md).

Run from the Web App folder:  python -m unittest discover -s tests -p "test_namekey.py" -v
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from services.namekey import parse, v1, v2  # noqa: E402


class SameEntity(unittest.TestCase):
 def same(self, a, b):
  self.assertEqual(v2(a), v2(b), f'{a!r} vs {b!r}')

 def test_thai_digits(self):
  self.same('บริษัท กิจธนาทรัพย์๑๖๘ จำกัด', 'กิจธนาทรัพย์168 จำกัด')

 def test_head_office_note(self):
  self.same('ซีเจโชคเจริญ (สำนักงานใหญ่)', 'ซีเจโชคเจริญ')
  self.same('บริษัท กาญจนบุรีค้าเหล็ก จำกัด (สำนักงานใหญ่)', 'กาญจนบุรีค้าเหล็ก จำกัด')

 def test_abbreviated_company_forms(self):
  for abbreviated in ('บจ.โกทูเทค', 'บจก.โกทูเทค', 'บ.โกทูเทค จำกัด', 'บริษัท โกทูเทค จำกัด'):
   self.same(abbreviated, 'โกทูเทค จำกัด')

 def test_abbreviated_partnership_forms(self):
  for abbreviated in ('หจก. สุธาวดี คอนสตรัคชั่น', 'หจก สุธาวดี คอนสตรัคชั่น', 'ห.จ.ก. สุธาวดี คอนสตรัคชั่น'):
   self.same(abbreviated, 'ห้างหุ้นส่วนจำกัด สุธาวดี คอนสตรัคชั่น')

 def test_branch_note_after_legal_form(self):
  self.same('บริษัท เอ็กซ์ จำกัด สาขาขอนแก่น', 'บริษัท เอ็กซ์ จำกัด')
  self.same('บริษัท เอ็กซ์ จำกัด (สาขาขอนแก่น)', 'บริษัท เอ็กซ์ จำกัด')

 def test_public_company_markers(self):
  self.same('บริษัท ไทยโซล่าร์ จำกัด (มหาชน)', 'บริษัท ไทยโซล่าร์ จำกัด(มหาชน)')
  self.assertEqual(parse('บริษัท ไทยโซล่าร์ จำกัด (มหาชน)')[0], 'pcl')

 def test_whitespace_and_dots(self):
  self.same('ห้างหุ้นส่วนจำกัด  ช.ศิวกร', 'ห้างหุ้นส่วนจำกัด ช.ศิวกร')
  self.same('B.K.กิ๊ฟช๊อป', 'BK กิ๊ฟช๊อป')


class DifferentEntity(unittest.TestCase):
 def test_legal_form_is_kept_as_a_tag(self):
  self.assertNotEqual(v2('บริษัท เอ จำกัด'), v2('ห้างหุ้นส่วนจำกัด เอ'))
  self.assertNotEqual(v2('บริษัท เอ จำกัด'), v2('บริษัท เอ จำกัด (มหาชน)'))

 def test_bare_name_is_not_treated_as_a_company(self):
  self.assertEqual(parse('ร้านนานาภัณฑ์')[0], '')
  self.assertNotEqual(v2('ร้านนานาภัณฑ์'), v2('บริษัท ร้านนานาภัณฑ์ จำกัด'))

 def test_spelling_variants_stay_apart(self):
  # no fuzzy matching: these need a reviewer, not a rule
  self.assertNotEqual(v2('กรุงเทพเซ้าอีสเอเซียแทรเวลเซอร์วิส จำกัด'), v2('กรุงเทพเซ้าอีสเอเชียแทรเวลเซอร์วิส จำกัด'))

 def test_branch_word_inside_a_name_is_kept(self):
  self.assertEqual(parse('ศูนย์สาขาวิชาเกษตร')[1], v1('ศูนย์สาขาวิชาเกษตร'))

 def test_a_legal_form_alone_is_not_emptied(self):
  self.assertEqual(parse('บริษัท'), ('', 'บริษัท'))
  self.assertEqual(parse('จำกัด')[1], v1('จำกัด'))


class Idempotent(unittest.TestCase):
 def test_v2_applied_to_a_v1_key_gives_the_same_result(self):
  # the database stores v1 keys, not the original names, so the pipeline runs v2 over them
  for name in ('บริษัท กิจธนาทรัพย์๑๖๘ จำกัด', 'ซีเจโชคเจริญ (สำนักงานใหญ่)', 'หจก. สุธาวดี คอนสตรัคชั่น', 'บจ.โกทูเทค'):
   self.assertEqual(v2(name), v2(v1(name)), name)


if __name__ == '__main__':
 unittest.main()
