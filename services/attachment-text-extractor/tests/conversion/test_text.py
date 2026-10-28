"""Text-family conversions (Req 1.5): HTML / XML / ipynb / plain / CSV-TSV."""

import json
import time

import pytest

from app.conversion.errors import ConversionError
from app.conversion.formats import TextKind
from app.conversion.limits import ConversionLimits
from app.conversion.text import convert_text
from fixture_files import JAPANESE_SAMPLE


def _limits(output_cap: int = 10_000) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=10_000,
        max_archive_uncompressed_mb=512,
        max_xlsx_cells=100_000,
        ipynb_output_max_chars=output_cap,
    )


def _html(markup: str, **kwargs: int) -> str:
    return convert_text(markup.encode(), "html", _limits(**kwargs))


def _xml(markup: str | bytes) -> str:
    data = markup.encode() if isinstance(markup, str) else markup
    return convert_text(data, "xml", _limits())


def _nb(notebook: object, cap: int = 10_000) -> str:
    return convert_text(json.dumps(notebook).encode(), "ipynb", _limits(cap))


# ---------------------------------------------------------------- plain


def test_plain_returns_decoded_text_unchanged(text_shift_jis: bytes) -> None:
    assert convert_text(text_shift_jis, "plain", _limits()) == JAPANESE_SAMPLE


def test_plain_strips_utf8_bom(text_utf8_bom: bytes) -> None:
    assert convert_text(text_utf8_bom, "plain", _limits()) == JAPANESE_SAMPLE


def test_plain_decodes_euc_jp(text_euc_jp: bytes) -> None:
    assert convert_text(text_euc_jp, "plain", _limits()) == JAPANESE_SAMPLE


def test_plain_json_and_yaml_are_not_parsed() -> None:
    nested = b"[" * 100_000 + b"]" * 100_000
    assert convert_text(nested, "plain", _limits()) == nested.decode()
    bomb = b"a: &a [x,x]\nb: &b [*a,*a]\nc: [*b,*b]\n"
    assert convert_text(bomb, "plain", _limits()) == bomb.decode()


def test_plain_empty_file_is_empty_string() -> None:
    assert convert_text(b"", "plain", _limits()) == ""


def test_plain_binary_garbage_does_not_raise() -> None:
    assert isinstance(convert_text(bytes(range(256)) * 10, "plain", _limits()), str)


# ---------------------------------------------------------------- html


def test_html_extracts_text_with_block_newlines() -> None:
    out = _html("<body><h1>Title</h1><p>Hello <b>big</b> world</p><ul><li>one</li><li>two</li></ul></body>")
    assert out == "Title\nHello big world\none\ntwo"


@pytest.mark.parametrize("tag", ["script", "style", "template", "noscript", "svg"])
def test_html_drops_skipped_element_content(tag: str) -> None:
    assert _html(f"<p>before</p><{tag}>SECRET <b>inner</b></{tag}><p>after</p>") == "before\nafter"


def test_html_script_inside_svg_is_dropped_and_text_after_survives() -> None:
    out = _html("<p>a</p><svg><script>alert(1)</script><text>vector</text></svg><p>b</p>")
    assert out == "a\nb"


def test_html_self_closing_svg_does_not_swallow_the_rest() -> None:
    assert _html("<p>a</p><svg/><p>b</p>") == "a\nb"


def test_html_unclosed_script_drops_only_the_tail() -> None:
    assert _html("<p>keep</p><script>var x = 1; <p>gone</p>") == "keep"


def test_html_comments_cdata_and_unterminated_constructs() -> None:
    assert _html("<p>a</p><!-- hidden --><p>b</p>") == "a\nb"
    out = _html("<p>a</p><![CDATA[ cdata ]]><p>b</p>")
    assert "a" in out and "b" in out
    assert isinstance(_html("<p>a</p><!-- never closed"), str)
    assert isinstance(_html("<p>a</p><div attr='never closed"), str)
    assert isinstance(_html("<p>a</p><![CDATA[ never closed"), str)


def test_html_entities_are_decoded_and_invalid_numeric_refs_do_not_raise() -> None:
    assert _html("<p>Tom &amp; Jerry &lt;3 &#12354;</p>") == "Tom & Jerry <3 あ"
    out = _html("<p>x&#0;y &#xD800;z &#99999999;w</p>")
    assert out.startswith("x") and "w" in out


def test_html_meta_charset_decides_the_decoding() -> None:
    body = "привет".encode("koi8-r")
    declared = convert_text(b'<meta charset="koi8-r"><p>' + body + b"</p>", "html", _limits())
    undeclared = convert_text(b"<p>" + body + b"</p>", "html", _limits())
    assert declared == "привет"
    assert undeclared != "привет"


def test_html_declared_charset_wins_over_valid_utf8() -> None:
    out = convert_text(b'<meta charset="windows-1252"><p>caf\xc3\xa9</p>', "html", _limits())
    assert out == "cafÃ©"


def test_html_http_equiv_content_type_charset_decides_the_decoding() -> None:
    head = b'<meta http-equiv="Content-Type" content="text/html; charset=KOI8-R">'
    out = convert_text(head + "<p>привет</p>".encode("koi8-r"), "html", _limits())
    assert out == "привет"


@pytest.mark.parametrize("declared", ["no-such-codec", "unicode_escape", "utf-16", "utf-7", "../../x", "a" * 5000])
def test_html_hostile_declared_charset_does_not_break_decoding(declared: str) -> None:
    out = convert_text(f'<meta charset="{declared}"><p>plain ascii body</p>'.encode(), "html", _limits())
    assert out == "plain ascii body"


def test_html_ten_megabyte_single_line_is_linear() -> None:
    start = time.monotonic()
    out = _html("<p>" + "word " * 2_000_000 + "</p>")
    assert time.monotonic() - start < 10
    assert out.startswith("word word")


def test_html_hundred_thousand_nested_divs_do_not_recurse() -> None:
    start = time.monotonic()
    out = _html("<div>" * 100_000 + "deep" + "</div>" * 100_000)
    assert time.monotonic() - start < 10
    assert out == "deep"


def test_html_many_unclosed_tags_are_not_quadratic() -> None:
    start = time.monotonic()
    _html("<a " * 100_000)
    _html("<!--" * 100_000)
    _html("<" * 200_000)
    assert time.monotonic() - start < 10


# ---------------------------------------------------------------- xml


def test_xml_strips_tags_and_keeps_text() -> None:
    assert _xml("<?xml version='1.0'?><root><a>one</a><b x='1'>two</b></root>") == "one\ntwo"


def test_xml_cdata_is_kept_and_comments_and_pis_are_dropped() -> None:
    out = _xml("<r><!-- hidden --><?pi secret?><a><![CDATA[<kept> & raw]]></a></r>")
    assert out == "<kept> & raw"


def test_xml_billion_laughs_is_not_expanded() -> None:
    entities = "".join(f'<!ENTITY lol{i} "{f"&lol{i - 1};" * 10}">' if i else '<!ENTITY lol0 "lol">' for i in range(10))
    start = time.monotonic()
    out = _xml(f"<?xml version='1.0'?><!DOCTYPE lolz [{entities}]><lolz>&lol9;</lolz>")
    assert time.monotonic() - start < 2
    assert len(out) < 100
    assert "ENTITY" not in out
    assert "<!DOCTYPE" not in out


def test_xml_doctype_with_gt_in_quotes_comments_and_entities_is_fully_removed() -> None:
    doctype = (
        '<!DOCTYPE root SYSTEM "a>b.dtd" [<!-- a > b ] --><!ENTITY e "x > y ]"><?pi > ?><!ELEMENT root (#PCDATA)>]>'
    )
    assert _xml(f"<?xml version='1.0'?>{doctype}<root>body</root>") == "body"


def test_xml_unterminated_constructs_do_not_raise() -> None:
    for fragment in ["<!DOCTYPE x [", '<!DOCTYPE x "', "<a b='", "<!-- x", "<![CDATA[ x", "<?pi", "<"]:
        assert isinstance(_xml(f"<r>t</r>{fragment}"), str)


def test_xml_gt_inside_attribute_value_does_not_leak_into_text() -> None:
    assert _xml('<a title="x > y">body</a>') == "body"


def test_xml_predefined_and_numeric_entities_are_decoded_custom_are_not() -> None:
    assert _xml("<a>x &amp; y &lt; &#65; &custom;</a>") == "x & y < A &custom;"


def test_xml_invalid_numeric_reference_stays_literal() -> None:
    assert _xml("<a>&#0; &#xD800; &#99999999;</a>") == "&#0; &#xD800; &#99999999;"


def test_xml_declared_encoding_decides_the_decoding() -> None:
    body = "привет".encode("koi8-r")
    declared = _xml(b"<?xml version='1.0' encoding='koi8-r'?><r>" + body + b"</r>")
    undeclared = _xml(b"<?xml version='1.0'?><r>" + body + b"</r>")
    assert declared == "привет"
    assert undeclared != "привет"


def test_xml_hostile_declared_encoding_does_not_raise() -> None:
    assert _xml(b"<?xml version='1.0' encoding='bogus-enc'?><r>ok</r>") == "ok"
    assert _xml(b"<?xml version='1.0' encoding='UTF-16'?><r>ok</r>") == "ok"


def test_xml_large_input_is_linear() -> None:
    start = time.monotonic()
    out = _xml("<r>" + "<a>x</a>" * 500_000 + "</r>")
    assert time.monotonic() - start < 10
    assert out.count("x") == 500_000


# ---------------------------------------------------------------- ipynb


def _notebook(cells: list[object]) -> dict[str, object]:
    return {"nbformat": 4, "nbformat_minor": 5, "metadata": {}, "cells": cells}


def test_ipynb_extracts_sources_and_text_outputs() -> None:
    out = _nb(
        _notebook(
            [
                {"cell_type": "markdown", "source": ["# Title\n", "intro"]},
                {
                    "cell_type": "code",
                    "source": "print('hi')",
                    "outputs": [
                        {"output_type": "stream", "name": "stdout", "text": ["hi\n"]},
                        {"output_type": "execute_result", "data": {"text/plain": "42"}},
                    ],
                },
            ]
        )
    )
    assert out == "# Title\nintro\nprint('hi')\nhi\n42"


def test_ipynb_drops_images_and_non_text_mime_types() -> None:
    out = _nb(
        _notebook(
            [
                {
                    "cell_type": "code",
                    "source": "plot()",
                    "outputs": [
                        {
                            "output_type": "display_data",
                            "data": {
                                "image/png": "iVBORw0KGgoBASE64DATA",
                                "application/json": {"k": "JSONDATA"},
                                "text/html": "<b>HTMLDATA</b>",
                                "text/plain": "<Figure>",
                            },
                        }
                    ],
                }
            ]
        )
    )
    assert out == "plot()\n<Figure>"


def test_ipynb_caps_each_output_but_not_sources() -> None:
    out = _nb(
        _notebook(
            [
                {
                    "cell_type": "code",
                    "source": "s" * 50,
                    "outputs": [
                        {"output_type": "stream", "text": "a" * 50},
                        {"output_type": "execute_result", "data": {"text/plain": ["b" * 30, "b" * 30]}},
                    ],
                }
            ]
        ),
        cap=20,
    )
    assert out == "\n".join(["s" * 50, "a" * 20, "b" * 20])


def test_ipynb_nbformat3_input_and_pyout() -> None:
    out = _nb(
        {
            "nbformat": 3,
            "worksheets": [
                {
                    "cells": [
                        {"cell_type": "code", "input": ["x = 1"], "outputs": [{"output_type": "pyout", "text": ["1"]}]},
                        {"cell_type": "markdown", "source": "note"},
                    ]
                }
            ],
        }
    )
    assert out == "x = 1\n1\nnote"


def test_ipynb_tolerates_malformed_cells_and_outputs() -> None:
    out = _nb(
        _notebook(
            [
                "not a dict",
                None,
                {"cell_type": "code", "source": 5, "outputs": "nope"},
                {"cell_type": "code", "source": [1, "ok"], "outputs": [None, {"output_type": "stream", "text": 3}]},
                {"cell_type": "code", "source": "tail", "outputs": [{"output_type": "display_data", "data": []}]},
            ]
        )
    )
    assert out == "ok\ntail"


def test_ipynb_error_outputs_contribute_nothing() -> None:
    error = {"output_type": "error", "traceback": ["\x1b[31mZeroDivisionError"]}
    out = _nb(_notebook([{"cell_type": "code", "source": "1/0", "outputs": [error]}]))
    assert out == "1/0"


def test_ipynb_invalid_json_falls_back_to_plain_text() -> None:
    assert convert_text(b'{"cells": [ broken', "ipynb", _limits()) == '{"cells": [ broken'


def test_ipynb_valid_json_that_is_not_a_notebook_falls_back_to_plain_text() -> None:
    assert convert_text(b'["a", "b"]', "ipynb", _limits()) == '["a", "b"]'


def test_ipynb_deeply_nested_json_falls_back_without_recursion_error() -> None:
    nested = b"[" * 200_000 + b"]" * 200_000
    assert convert_text(nested, "ipynb", _limits()) == nested.decode()


def test_ipynb_japanese_shift_jis_is_decoded() -> None:
    data = json.dumps(_notebook([{"cell_type": "markdown", "source": JAPANESE_SAMPLE}]), ensure_ascii=False).encode(
        "shift_jis"
    )
    assert convert_text(data, "ipynb", _limits()) == JAPANESE_SAMPLE


# ---------------------------------------------------------------- csv / tsv


def test_csv_is_converted_to_a_markdown_table() -> None:
    assert convert_text(b"a,b\n1,2\n", "csv", _limits()) == "| a | b |\n| --- | --- |\n| 1 | 2 |\n"


def test_csv_shift_jis_has_no_mojibake() -> None:
    data = "名前,年齢\n太郎,3\n".encode("shift_jis")
    assert convert_text(data, "csv", _limits()) == "| 名前 | 年齢 |\n| --- | --- |\n| 太郎 | 3 |\n"


def test_csv_utf8_bom_is_not_part_of_the_first_header() -> None:
    out = convert_text("名前,年齢\n太郎,3\n".encode("utf-8-sig"), "csv", _limits())
    assert out.startswith("| 名前 |")


def test_tsv_fields_with_commas_and_quotes_keep_their_columns() -> None:
    data = b'a\tb\tc\n1,2\t"say ""hi"""\t3\n'
    assert convert_text(data, "csv", _limits()) == '| a | b | c |\n| --- | --- | --- |\n| 1,2 | say "hi" | 3 |\n'


def test_csv_empty_file_is_empty_string() -> None:
    assert convert_text(b"", "csv", _limits()) == ""


def test_csv_binary_garbage_does_not_leak_a_non_conversion_error() -> None:
    try:
        assert isinstance(convert_text(bytes(range(256)) * 10, "csv", _limits()), str)
    except ConversionError:
        pass


# ---------------------------------------------------------------- robustness: time, memory, lone surrogates


def test_xml_start_tag_with_many_quoted_attributes_is_linear() -> None:
    start = time.monotonic()
    out = _xml(b"<a" + b" b='x'" * 400_000 + b">t</a>")
    assert time.monotonic() - start < 5
    assert out == "t"


def test_xml_tag_with_unclosed_quote_and_far_gt_do_not_stall() -> None:
    start = time.monotonic()
    assert _xml(b"<a b='" + b"x" * 4_000_000) == ""
    assert _xml(b"<a " + b"x" * 4_000_000 + b">t</a>") == "t"
    assert _xml(b"<a " + b"'\"" * 1_000_000 + b">t</a>") == ""
    assert time.monotonic() - start < 5


def test_xml_doctype_internal_subset_with_many_entities_is_linear() -> None:
    start = time.monotonic()
    out = _xml(b"<!DOCTYPE r [" + b"<!ENTITY a 'x'>" * 300_000 + b"]><r>t</r>")
    assert time.monotonic() - start < 5
    assert out == "t"


def test_html_and_xml_keep_ideographic_space_and_collapse_ascii_spaces() -> None:
    assert _html("<p>a\u3000b   c\t\td</p>") == "a\u3000b c d"
    assert _xml("<r>a\u3000b   c</r>") == "a\u3000b c"


def test_html_and_xml_trim_lines_and_drop_blank_lines() -> None:
    assert _html("<p>  a  </p>\n\n\n<p>   </p><p>b</p>") == "a\nb"
    assert _xml("<r>\n  <a> x </a>\n\n\n  <b>y</b>\n</r>") == "x\ny"


@pytest.mark.parametrize("kind", ["html", "xml", "ipynb", "plain", "csv"])
def test_lone_surrogates_never_reach_the_result(kind: TextKind) -> None:
    payloads = {
        "html": b"<p>a&#xD800;b \xed\xa0\x80 c</p>",
        "xml": b"<r>a&#xD800;b \xed\xa0\x80 c</r>",
        "ipynb": json.dumps(
            _notebook(
                [{"cell_type": "code", "source": "\ud800x", "outputs": [{"output_type": "stream", "text": "\udfffy"}]}]
            )
        ).encode(),
        "plain": b'{"k": "\\ud800"} \xed\xa0\x80',
        "csv": b"a,b\n\xed\xa0\x80,2\n",
    }
    out = convert_text(payloads[kind], kind, _limits())
    out.encode("utf-8")


def test_ipynb_lone_surrogate_becomes_replacement_character() -> None:
    assert _nb(_notebook([{"cell_type": "code", "source": "\ud800x"}])) == "\ufffdx"
