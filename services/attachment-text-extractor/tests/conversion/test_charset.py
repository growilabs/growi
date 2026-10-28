import codecs

import pytest

from app.conversion.charset import decode

LONG_JA = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。" * 3
SHORT_JA = "会議資料"
SHORT_JA_SENTENCE = "日本語のテスト"


@pytest.mark.parametrize("text", [LONG_JA, SHORT_JA, "plain ascii", "café ünï"])
def test_utf8_without_bom(text: str) -> None:
    assert decode(text.encode("utf-8")) == text


def test_utf8_bom_is_stripped() -> None:
    assert decode(codecs.BOM_UTF8 + LONG_JA.encode("utf-8")) == LONG_JA


@pytest.mark.parametrize(
    ("bom", "codec"),
    [(codecs.BOM_UTF16_LE, "utf-16-le"), (codecs.BOM_UTF16_BE, "utf-16-be")],
)
def test_utf16_with_bom(bom: bytes, codec: str) -> None:
    assert decode(bom + LONG_JA.encode(codec)) == LONG_JA


@pytest.mark.parametrize("text", [LONG_JA, SHORT_JA, SHORT_JA_SENTENCE])
def test_shift_jis_including_short_samples(text: str) -> None:
    assert decode(text.encode("cp932")) == text


def test_shift_jis_with_cp932_extension_characters() -> None:
    text = "①②③ ㈱テスト 髙橋"
    assert decode(text.encode("cp932")) == text


@pytest.mark.parametrize("text", [LONG_JA, SHORT_JA_SENTENCE])
def test_euc_jp(text: str) -> None:
    assert decode(text.encode("euc_jp")) == text


@pytest.mark.parametrize("text", [LONG_JA, SHORT_JA_SENTENCE])
def test_iso_2022_jp(text: str) -> None:
    assert decode(text.encode("iso2022_jp")) == text


def test_cp1252() -> None:
    text = "Price: €5 – “quoted” café résumé naïve"
    assert decode(text.encode("cp1252")) == text


def test_empty_bytes() -> None:
    assert decode(b"") == ""


def test_declared_charset_wins_over_detection() -> None:
    html = f'<html><head><meta charset="shift_jis"></head><body>{LONG_JA}</body></html>'
    assert decode(html.encode("cp932"), declared="shift_jis") == html


def test_declared_charset_alias_is_resolved() -> None:
    html = f"<p>{SHORT_JA}</p>"
    assert decode(html.encode("euc_jp"), declared="EUC-JP") == html


def test_declared_charset_is_case_insensitive() -> None:
    assert decode(SHORT_JA.encode("cp932"), declared="Shift_JIS") == SHORT_JA


def test_unknown_declared_charset_falls_back_to_detection() -> None:
    assert decode(LONG_JA.encode("utf-8"), declared="no-such-charset") == LONG_JA


def test_wrong_declared_charset_falls_back_to_detection() -> None:
    assert decode(LONG_JA.encode("utf-8"), declared="ascii") == LONG_JA


def test_bom_wins_over_declared_charset() -> None:
    data = codecs.BOM_UTF8 + LONG_JA.encode("utf-8")
    assert decode(data, declared="shift_jis") == LONG_JA


def test_undecodable_bytes_fall_back_to_latin1() -> None:
    data = b"\x81\x00\xff\xfe\x80\x81\x82 abc"
    assert decode(data) == data.decode("latin-1")


@pytest.mark.parametrize("declared", ["\x00", "undefined"])
def test_malformed_declared_charset_is_ignored(declared: str) -> None:
    assert decode(b"abc", declared=declared) == "abc"
    assert decode(SHORT_JA.encode("cp932"), declared=declared) == SHORT_JA


@pytest.mark.parametrize(
    "declared",
    [
        "unicode_escape",
        "raw_unicode_escape",
        "undefined",
        "rot13",
        "hex",
        "base64",
        "zlib",
        "punycode",
        "idna",
        "utf_7",
    ],
)
def test_non_charset_declared_codec_is_ignored(declared: str) -> None:
    assert decode(SHORT_JA_SENTENCE.encode("cp932"), declared=declared) == (SHORT_JA_SENTENCE)
    assert decode(LONG_JA.encode("cp932"), declared=declared) == LONG_JA


@pytest.mark.parametrize("text", [SHORT_JA, SHORT_JA_SENTENCE])
def test_short_euc_jp_and_iso_2022_jp(text: str) -> None:
    assert decode(text.encode("euc_jp")) == text
    assert decode(text.encode("iso2022_jp")) == text


def test_utf8_containing_escape_sequences_is_unchanged() -> None:
    text = "ansi \x1b[31mred\x1b[0m $B (J \x1b$B literal \x1b(J 日本語"
    assert decode(text.encode("utf-8")) == text
    plain = "\x1b[1mbold\x1b[0m ascii only"
    assert decode(plain.encode("utf-8")) == plain


@pytest.mark.parametrize(
    ("bom", "codec"),
    [(codecs.BOM_UTF32_LE, "utf-32-le"), (codecs.BOM_UTF32_BE, "utf-32-be")],
)
def test_utf32_with_bom(bom: bytes, codec: str) -> None:
    assert decode(bom + LONG_JA.encode(codec)) == LONG_JA


def test_cp1252_longer_than_a_sentence() -> None:
    text = (
        "The “quarterly” report shows revenue of €1,250,000 – up 12% – "
        "and the café’s résumé of naïve forecasts was ‘rejected’. "
    ) * 3
    assert decode(text.encode("cp1252")) == text
