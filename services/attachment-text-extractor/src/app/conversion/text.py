"""Text-family conversions (Req 1.5): HTML / XML / ipynb / plain text / CSV-TSV."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser

from app.conversion.charset import decode
from app.conversion.formats import TextKind
from app.conversion.limits import ConversionLimits
from app.conversion.office import convert_office

_HTML_SKIPPED = frozenset({"script", "style", "template", "noscript", "svg"})
_HTML_BLOCKS = frozenset(
    {
        "address", "article", "aside", "blockquote", "body", "br", "dd", "details", "div", "dl", "dt",
        "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
        "header", "hr", "html", "li", "main", "nav", "ol", "p", "pre", "section", "summary", "table",
        "tbody", "tfoot", "thead", "title", "tr", "ul",
    }
)  # fmt: skip
_HTML_CELLS = frozenset({"td", "th"})

# Only the first bytes are scanned: HTML declares its charset in the head, and the bound keeps the
# pattern linear on hostile input.
_META_SCAN_BYTES = 4096
_META_CHARSET = re.compile(rb"<meta\b[^>]*?charset\s*=\s*[\"']?\s*([A-Za-z0-9_.:-]{1,64})", re.IGNORECASE)
_XML_DECL_SCAN_BYTES = 256
_XML_ENCODING = re.compile(rb"\A\s*<\?xml\b[^>]*?encoding\s*=\s*[\"']([A-Za-z0-9_.:-]{1,64})[\"']", re.IGNORECASE)

# Plain XML entities only; custom entities stay literal so nothing is ever expanded recursively.
_XML_PREDEFINED = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
_XML_REFERENCE = re.compile(r"&(?:(amp|lt|gt|quot|apos)|#(\d{1,8})|#x([0-9A-Fa-f]{1,6}));")
_TAG_SCAN = re.compile(r"[>\"']")
_DOCTYPE_SCAN = re.compile(r"[>\[\"']")
_SUBSET_SCAN = re.compile(r"\]|\"|'|<!--|<\?")

_IPYNB_TEXT_MIME = "text/plain"


def convert_text(data: bytes, kind: TextKind, limits: ConversionLimits) -> str:
    """Return the text of a text-family attachment; only the CSV path can raise ConversionError."""
    if kind == "html":
        return _html_to_text(decode(data, _declared_charset(data[:_META_SCAN_BYTES], _META_CHARSET)))
    if kind == "xml":
        return _xml_to_text(decode(data, _declared_charset(data[:_XML_DECL_SCAN_BYTES], _XML_ENCODING)))
    if kind == "ipynb":
        return _ipynb_to_text(decode(data), limits.ipynb_output_max_chars)
    if kind == "csv":
        # anydoc only reads UTF-8, and the delimiter (comma or tab) is detected on its side.
        return convert_office(decode(data).encode("utf-8"), "csv")
    return decode(data)


def _declared_charset(head: bytes, pattern: re.Pattern[bytes]) -> str | None:
    match = pattern.search(head)
    if match is None:
        return None
    name = match.group(1).decode("ascii")
    # The bytes were just matched as ASCII, so a UTF-16/32 declaration is wrong (browsers treat it as UTF-8).
    if name.lower().replace("_", "-").startswith(("utf-16", "utf-32", "ucs-")):
        return "utf-8"
    return name


# Only ASCII blanks are folded: U+3000 and U+00A0 can be meaningful in Japanese text. Each part is folded on
# its own because one re.sub over the whole document keeps a list of every match and costs more memory
# than the document itself.
_LINE_BREAK = re.compile(r"\r\n?")
_BLANKS = re.compile(r"[ \t\f\v]+")
_LINE_EDGES = re.compile(r" ?\n[ \n]*")
_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


class _LineJoiner:
    """Accumulates parts into trimmed, single-spaced lines without blank lines."""

    def __init__(self) -> None:
        self._out: list[str] = []
        self._last = "\n"  # class of the last emitted character: "\n" (or start), " ", or anything else

    def add(self, part: str) -> None:
        folded = _LINE_EDGES.sub("\n", _BLANKS.sub(" ", _LINE_BREAK.sub("\n", part)))
        if not folded:
            return
        if folded[0] == "\n" and self._last == " ":
            self._out[-1] = self._out[-1].rstrip(" ")
            self._last = "x"
        if self._last == "\n":
            folded = folded.lstrip(" \n")
        elif self._last == " ":
            folded = folded.lstrip(" ")
        if not folded:
            return
        self._out.append(folded)
        self._last = folded[-1] if folded[-1] in "\n " else "x"

    def result(self) -> str:
        return "".join(self._out).rstrip(" \n")


# ---------------------------------------------------------------- HTML


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines = _LineJoiner()
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _HTML_SKIPPED:
            self._skip_depth += 1
        else:
            self._separate(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        # "<svg/>" has no content to skip, so it must not open a skipped region.
        if tag not in _HTML_SKIPPED:
            self._separate(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in _HTML_SKIPPED:
            self._skip_depth = max(0, self._skip_depth - 1)
        else:
            self._separate(tag)

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self.lines.add(data)

    def _separate(self, tag: str) -> None:
        if self._skip_depth:
            return
        if tag in _HTML_BLOCKS:
            self.lines.add("\n")
        elif tag in _HTML_CELLS:
            self.lines.add(" ")


def _html_to_text(markup: str) -> str:
    extractor = _TextExtractor()
    extractor.feed(markup)
    extractor.close()
    return extractor.lines.result()


# ---------------------------------------------------------------- XML


def _decode_reference(match: re.Match[str]) -> str:
    named, decimal, hexadecimal = match.groups()
    if named:
        return _XML_PREDEFINED[named]
    code_point = int(decimal) if decimal else int(hexadecimal, 16)
    if 0 < code_point <= 0x10FFFF and not 0xD800 <= code_point <= 0xDFFF:
        return chr(code_point)
    return match.group(0)


def _skip_quoted(text: str, quote_at: int) -> int:
    """Index just past the quoted string opening at quote_at, or -1 if it never closes."""
    end = text.find(text[quote_at], quote_at + 1)
    return -1 if end < 0 else end + 1


def _skip_doctype(text: str, start: int) -> int:
    """Index just past a DOCTYPE starting at start (quotes, comments and the internal subset respected), or -1."""
    pos = start + len("<!DOCTYPE")
    while True:
        match = _DOCTYPE_SCAN.search(text, pos)
        if match is None:
            return -1
        char = match.group()
        if char == ">":
            return match.end()
        if char == "[":
            pos = _skip_internal_subset(text, match.end())
        else:
            pos = _skip_quoted(text, match.start())
        if pos < 0:
            return -1


def _skip_internal_subset(text: str, pos: int) -> int:
    while True:
        match = _SUBSET_SCAN.search(text, pos)
        if match is None:
            return -1
        marker = match.group()
        if marker == "]":
            return match.end()
        if marker == "<!--":
            end = text.find("-->", match.end())
            pos = -1 if end < 0 else end + 3
        elif marker == "<?":
            end = text.find("?>", match.end())
            pos = -1 if end < 0 else end + 2
        else:
            pos = _skip_quoted(text, match.start())
        if pos < 0:
            return -1


def _skip_tag(text: str, start: int) -> int:
    """Index just past the tag starting at start; a ">" inside a quoted attribute value does not end it."""
    pos = start + 1
    while True:
        match = _TAG_SCAN.search(text, pos)
        if match is None:
            return -1
        if match.group() == ">":
            return match.end()
        pos = _skip_quoted(text, match.start())
        if pos < 0:
            return -1


def _skip_to_marker(text: str, start: int, opener: str, closer: str) -> tuple[int, int]:
    """Return (content_start, index past the closer), or (content_start, -1) when it never closes."""
    content_start = start + len(opener)
    end = text.find(closer, content_start)
    return content_start, -1 if end < 0 else end + len(closer)


def _xml_to_text(markup: str) -> str:
    # The XML is never parsed, so entity expansion (billion laughs) cannot happen. A construct that never
    # closes ends the text there instead of failing.
    lines = _LineJoiner()
    pos = 0
    while True:
        lt = markup.find("<", pos)
        if lt < 0:
            lines.add(_XML_REFERENCE.sub(_decode_reference, markup[pos:]))
            break
        lines.add(_XML_REFERENCE.sub(_decode_reference, markup[pos:lt]))
        if markup.startswith("<![CDATA[", lt):
            content_start, after = _skip_to_marker(markup, lt, "<![CDATA[", "]]>")
            end = after - 3 if after >= 0 else len(markup)
            lines.add(markup[content_start:end])
        elif markup.startswith("<!--", lt):
            after = _skip_to_marker(markup, lt, "<!--", "-->")[1]
        elif markup.startswith("<?", lt):
            after = _skip_to_marker(markup, lt, "<?", "?>")[1]
        elif markup[lt : lt + 9].upper() == "<!DOCTYPE":
            after = _skip_doctype(markup, lt)
        else:
            after = _skip_tag(markup, lt)
        if after < 0:
            break
        lines.add("\n")
        pos = after
    return lines.result()


# ---------------------------------------------------------------- ipynb


def _as_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(item for item in value if isinstance(item, str))
    return ""


def _output_texts(output: object, cap: int) -> list[str]:
    if not isinstance(output, dict):
        return []
    texts: list[str] = []
    # v4 keeps text/plain under "data"; v3 (pyout / stream) keeps "text" directly.
    if isinstance(bundle := output.get("data"), dict):
        texts.append(_as_text(bundle.get(_IPYNB_TEXT_MIME)))
    if output.get("output_type") in ("stream", "pyout", "execute_result", "display_data"):
        texts.append(_as_text(output.get("text")))
    return [text[:cap] for text in texts if text]


def _cell_texts(cell: object, cap: int) -> list[str]:
    if not isinstance(cell, dict):
        return []
    texts = [_as_text(cell.get("source")) or _as_text(cell.get("input"))]
    outputs = cell.get("outputs")
    if isinstance(outputs, list):
        for output in outputs:
            texts.extend(_output_texts(output, cap))
    return [text.rstrip("\n") for text in texts if text]


def _notebook_cells(notebook: object) -> list[object] | None:
    if not isinstance(notebook, dict):
        return None
    if isinstance(cells := notebook.get("cells"), list):
        return cells
    if isinstance(worksheets := notebook.get("worksheets"), list):
        return [
            cell
            for sheet in worksheets
            if isinstance(sheet, dict) and isinstance(sheet.get("cells"), list)
            for cell in sheet["cells"]
        ]
    return None


def _ipynb_to_text(text: str, output_cap: int) -> str:
    try:
        notebook = json.loads(text)
    except (ValueError, RecursionError):
        return text
    cells = _notebook_cells(notebook)
    if cells is None:
        return text
    joined = "\n".join(piece for cell in cells for piece in _cell_texts(cell, output_cap))
    # JSON allows lone surrogates, which UTF-8 (and so the JSON response) cannot encode.
    return _LONE_SURROGATE.sub("\ufffd", joined)
