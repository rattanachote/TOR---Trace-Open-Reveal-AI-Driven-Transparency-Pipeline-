"""Search-text normalisation for Thai names.

Source names are stored as published: DBD names often contain double spaces ("นาย ยงยุทธ  ปวิตรปก") and
e-GP winner names carry legal forms ("บริษัท ... จำกัด"). Search terms are therefore split into tokens with
titles and legal forms removed, and matched as "%tok1%tok2%" so any spacing in the source still matches.
Removing words only ever broadens a match, so a stripped title can never hide a result.
"""
import re, unicodedata

_TO_ARABIC = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
_TO_THAI = str.maketrans('0123456789', '๐๑๒๓๔๕๖๗๘๙')

# Longest first so "นางสาว" is removed before "นาง".
TITLES = sorted({
 'นางสาว', 'นาง', 'นาย', 'น.ส.', 'ด.ช.', 'ด.ญ.', 'ดร.', 'คุณ',
 'บริษัท', 'บจก.', 'บมจ.', 'จำกัด', '(มหาชน)', 'มหาชน', 'หจก.', 'หสน.',
 'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญนิติบุคคล', 'ห้างหุ้นส่วนสามัญ', 'ห้างหุ้นส่วน',
}, key=len, reverse=True)
ATTACHED = ('นางสาว', 'นาย', 'นาง')  # personal titles often typed without a space: "นายสมชาย"
ABBREVIATIONS = ('บมจ.', 'บจก.', 'หจก.', 'หสน.', 'บจ.')  # company forms often typed without a space: "บจก.โกทูเทค"


def tokens(term):
 words = []
 # Thai digits in the term become Arabic; like_any() adds the Thai-digit spelling back when it queries
 for word in re.sub(r'[%_]', ' ', (term or '').translate(_TO_ARABIC)).split():
  if word in TITLES: continue
  for title in ATTACHED + ABBREVIATIONS:
   if word.startswith(title) and len(word) - len(title) >= 2:
    word = word[len(title):]; break
  words.append(word)
 return words or (term or '').translate(_TO_ARABIC).split()


def like(term):
 """LIKE pattern that matches the words in order with any spacing between them."""
 words = tokens(term)
 return '%' + '%'.join(words) + '%' if words else '%'


def like_any(column, pattern):
 """(SQL, args) matching a column against a LIKE pattern in both digit spellings.

 Names are stored as published, so "กิจธนาทรัพย์๑๖๘" must be found by "กิจธนาทรัพย์168" and the other way round."""
 thai = pattern.translate(_TO_THAI)
 if thai == pattern: return f'{column} LIKE ?', [pattern]
 return f'({column} LIKE ? OR {column} LIKE ?)', [pattern, thai]


def compact(term):
 """Whitespace-free, case-folded form used by the *_key columns (same rule as the import pipeline)."""
 return re.sub(r'\s+', '', unicodedata.normalize('NFKC', ''.join(tokens(term)))).casefold()
