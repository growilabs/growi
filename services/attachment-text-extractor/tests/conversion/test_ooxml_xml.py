from xml.etree.ElementTree import tostring

import pytest

from app.conversion.errors import ConversionError
from app.conversion.ooxml_xml import local_name, parse, register_prefixes

_NS = b'<r:root xmlns:r="urn:r" xmlns:mc="urn:mc" mc:Ignorable="x"><r:child/></r:root>'


def test_parse_returns_root_element():
    assert local_name(parse(_NS, "part").tag) == "root"


@pytest.mark.parametrize(
    "body",
    [
        b"<a><b></a>",
        b"",
        b'<?xml version="1.0" encoding="no-such-encoding"?><a/>',
        b'<?xml version="1.0" encoding="UTF-16"?><a/>',
    ],
)
def test_parse_maps_unusable_xml_to_malformed(body):
    with pytest.raises(ConversionError) as info:
        parse(body, "part")
    assert info.value.kind == "malformed"


def test_parse_rejects_entity_expansion():
    bomb = b'<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "xxxx"><!ENTITY y "&x;&x;&x;">]><a>&y;</a>'
    with pytest.raises(ConversionError) as info:
        parse(bomb, "part")
    assert info.value.kind == "malformed"


def test_parse_error_message_names_the_part():
    with pytest.raises(ConversionError, match="workbook.xml"):
        parse(b"<a>", "workbook.xml")


def test_register_prefixes_maps_malformed_input():
    with pytest.raises(ConversionError) as info:
        register_prefixes(b"<a><b></a>", "part")
    assert info.value.kind == "malformed"


def test_register_prefixes_keeps_document_prefixes_on_serialisation():
    root = parse(_NS, "part")
    register_prefixes(_NS, "part")
    out = tostring(root, encoding="unicode")
    assert "<r:root" in out and 'xmlns:mc="urn:mc"' in out and "ns0" not in out


def test_local_name_strips_namespace():
    assert local_name("{urn:x}sheet") == "sheet"
    assert local_name("plain") == "plain"
