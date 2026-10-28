"""Pure text normalization applied to extracted text."""

import re

# Hiragana, katakana (includes the prolonged sound mark), CJK ideographs
# (unified + extension A) and the iteration mark. Other CJK punctuation and
# full-width forms are deliberately excluded: they carry authored spacing.
_JA = "ぁ-ゖゝ-ゟァ-ヺー-ヿ㐀-䶿一-鿿々"

# Lookarounds keep neighbors unconsumed so chained gaps ("あ い う") all close,
# and the single-character match leaves blank lines and double spaces intact.
_JA_GAP = re.compile(f"(?<=[{_JA}])[ \n](?=[{_JA}])")


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def join_broken_japanese(text: str) -> str:
    return _JA_GAP.sub("", text)
