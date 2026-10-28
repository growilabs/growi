"""TextNormalizer: newline unification and Japanese gap-closing."""

import pytest

from app.conversion.normalize import join_broken_japanese, normalize_newlines


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("a\r\nb", "a\nb"),
        ("a\rb", "a\nb"),
        ("a\r\n\r\nb", "a\n\nb"),
        ("a\r\rb", "a\n\nb"),
        ("a\nb\n", "a\nb\n"),
        ("", ""),
    ],
)
def test_normalize_newlines(text: str, expected: str) -> None:
    assert normalize_newlines(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # a single newline or ASCII space between Japanese characters is removed
        ("情報シス\nテム", "情報システム"),
        ("情報 システム", "情報システム"),
        # every script class named by the design counts as Japanese
        ("あ\nい", "あい"),
        ("ア\nイ", "アイ"),
        ("漢\n字", "漢字"),
        ("人\n々", "人々"),
        ("コー\nヒー", "コーヒー"),
        # chained breaks are all closed
        ("あ い う\nえ", "あいうえ"),
        # paragraph breaks are kept
        ("障害対応メモ\n\n本番環境", "障害対応メモ\n\n本番環境"),
        ("あ\n\n\nい", "あ\n\n\nい"),
        # full-width space written by the author is kept
        ("あ　い", "あ　い"),
        # more than one space is not an extraction artifact
        ("あ  い", "あ  い"),
        ("あ \nい", "あ \nい"),
        # spaces between English words are kept
        ("hello world", "hello world"),
        ("hello\nworld", "hello\nworld"),
        # a Japanese character next to ASCII is not a Japanese gap
        ("あ b", "あ b"),
        ("a い", "a い"),
        ("あ\nb", "あ\nb"),
        ("a\nい", "a\nい"),
        ("2024 年", "2024 年"),
        # leading and trailing whitespace has no Japanese neighbor on one side
        ("あい\n", "あい\n"),
        (" あい ", " あい "),
        ("", ""),
    ],
)
def test_join_broken_japanese(text: str, expected: str) -> None:
    assert join_broken_japanese(text) == expected
