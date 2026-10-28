"""XML helpers shared by the OOXML splitters (pptx_split, xlsx_split)."""

from __future__ import annotations

import io
import re
from xml.etree.ElementTree import Element, ParseError, register_namespace

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring, iterparse

from app.conversion.errors import ConversionError

# Besides ParseError, expat raises LookupError for an unknown declared encoding and ValueError
# (UnicodeError included) for one it cannot use; all of them mean the part is not usable XML.
_XML_ERRORS = (ParseError, DefusedXmlException, LookupError, ValueError)


def parse(body: bytes, label: str) -> Element:
    try:
        return fromstring(body)
    except _XML_ERRORS:
        raise ConversionError("malformed", f"{label} is not well-formed XML") from None


def register_prefixes(body: bytes, label: str) -> None:
    # Keeping the document's own prefixes avoids ns0-style renames that break mc:Ignorable lists.
    try:
        for _event, (prefix, uri) in iterparse(io.BytesIO(body), events=("start-ns",)):
            if prefix and not re.fullmatch(r"ns\d+", prefix):
                register_namespace(prefix, uri)
    except _XML_ERRORS:
        raise ConversionError("malformed", f"{label} is not well-formed XML") from None


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
