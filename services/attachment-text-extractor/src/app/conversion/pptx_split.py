"""PPTX conversion slide by slide through anydoc (Req 1.2, 2.6).

anydoc emits no slide boundaries, so each slide is converted from its own package: the
original presentation reduced to that one slide plus the XML parts it reaches.
"""

from __future__ import annotations

import io
import posixpath
import re
import zipfile
from collections.abc import Iterator
from collections.abc import Set as AbstractSet
from dataclasses import dataclass
from urllib.parse import unquote
from xml.etree.ElementTree import Element, ParseError, register_namespace, tostring
from xml.sax.saxutils import quoteattr

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring, iterparse

from app.conversion.archive_guard import inspect_archive, read_part
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.office import convert_office
from app.schemas import PageInfo

_MIB = 1024 * 1024
_PRESENTATION = "ppt/presentation.xml"
_CONTENT_TYPES = "[Content_Types].xml"
_ROOT_RELS = "_rels/.rels"
_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
# Both the transitional and the Strict OOXML relationship namespaces end like this.
_SLIDE_REL_SUFFIX = "/slide"
_REL_ID_SUFFIX = "relationships}id"

# PowerPoint writes generated alt text as "<description>\n\n<fixed sentence>"; anydoc folds each
# newline into a space, so a whole line of "<text>  <fixed sentence>" (two spaces) is that alt
# text. Author paragraphs ending in the same sentence lack the two-space join and are kept.
_AUTO_ALT_TEXT_LINE = re.compile(
    r"^[^\n]*\S  (?:Description automatically generated(?: with (?:high|medium|low) confidence)?"
    r"|AI-generated content may be incorrect\.|自動的に生成された説明|AI 生成コンテンツは誤りを含む可能性があります。)"
    r"[ \t]*(?:\n\n?|\Z)",
    re.MULTILINE,
)
# anydoc marks a soft line break with a trailing backslash and escapes literal ones as "\\",
# so only an odd run of trailing backslashes ends in a marker.
_LINE_BREAK_MARKER = re.compile(r"(?<!\\)((?:\\\\)*)\\$", re.MULTILINE)
# Besides ParseError, expat raises LookupError for an unknown declared encoding and ValueError
# (UnicodeError included) for one it cannot use; all of them mean the part is not usable XML.
_XML_ERRORS = (ParseError, DefusedXmlException, LookupError, ValueError)


@dataclass(frozen=True)
class _Relationship:
    rel_id: str
    rel_type: str
    target: str
    external: bool
    part: str | None  # resolved part name inside the archive, None when unusable


def convert_pptx(data: bytes, limits: ConversionLimits) -> list[PageInfo]:
    """Return one element per slide in presentation order; raise ConversionError on failure.

    Packages that fail the ZIP pre-check (encrypted OOXML, legacy PPT) go to anydoc whole
    and come back as a single unnumbered element.
    """
    archive = inspect_archive(data, _PRESENTATION, limits)
    if archive is None:
        return [PageInfo(pageNumber=None, label=None, content=_clean(convert_office(data, "pptx")))]
    try:
        splitter = _Splitter(archive, limits)
        return [
            PageInfo(pageNumber=number, label=str(number), content=_clean(convert_office(package, "pptx")))
            for number, package in enumerate(splitter.packages(), start=1)
        ]
    finally:
        archive.close()


def _clean(markdown: str) -> str:
    return _LINE_BREAK_MARKER.sub(r"\1", _AUTO_ALT_TEXT_LINE.sub("", markdown))


class _Splitter:
    def __init__(self, archive: zipfile.ZipFile, limits: ConversionLimits) -> None:
        self._archive = archive
        self._names = {info.filename for info in archive.infolist()}
        # Counts bytes actually decompressed, so re-reading one huge slide per list entry still stops.
        self._budget = limits.max_archive_uncompressed_mb * _MIB
        self._rels: dict[str, list[_Relationship]] = {}
        self._raw_rels: dict[str, bytes] = {}
        self._shared: dict[str, bytes] = {}

        presentation_xml = self._read(_PRESENTATION)
        self._presentation = _parse(presentation_xml)
        _register_prefixes(presentation_xml)
        self._slide_id_list = _find_child(self._presentation, "sldIdLst")
        self._slide_ids: list[Element] = []
        if self._slide_id_list is not None:
            self._slide_ids = [child for child in self._slide_id_list if _local_name(child.tag) == "sldId"]
            if len(self._slide_ids) > limits.max_archive_entries:
                raise ConversionError("limit_exceeded", "slide list is longer than the archive entry limit")
            # Emptied once; each package re-adds only its own entry.
            for entry in self._slide_ids:
                self._slide_id_list.remove(entry)

        self._presentation_rels = self._relationships(_PRESENTATION)
        self._slide_parts = {rel.part for rel in self._presentation_rels if _is_slide(rel) and rel.part}
        shared_roots = [rel.part for rel in self._relationships("") if rel.part and rel.part != _PRESENTATION]
        shared_roots += [rel.part for rel in self._presentation_rels if rel.part and not _is_slide(rel)]
        for part in self._closure(shared_roots, excluded=self._slide_parts | {_PRESENTATION}):
            self._shared[part] = self._read(part)
        self._content_types = _parse(self._read(_CONTENT_TYPES))

    def packages(self) -> Iterator[bytes]:
        """One package per slide entry, built lazily so only one is held in memory at a time."""
        by_id = {rel.rel_id: rel for rel in self._presentation_rels}
        for entry in self._slide_ids:
            rel = by_id.get(_rel_id_of(entry) or "")
            if rel is None or not _is_slide(rel) or rel.part is None:
                raise ConversionError("malformed", "slide list entry does not point at a slide part")
            yield self._package(entry, rel, rel.part)

    def _package(self, entry: Element, slide_rel: _Relationship, slide: str) -> bytes:
        # Other slides stay out even when hyperlinked, or every package would grow with the deck.
        excluded = (self._slide_parts - {slide}) | {_PRESENTATION} | self._shared.keys()
        parts = {**self._shared, **{part: self._read(part) for part in self._closure([slide], excluded)}}
        kept_rels = [rel for rel in self._presentation_rels if not _is_slide(rel) or rel is slide_rel]

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as out:
            out.writestr(_CONTENT_TYPES, self._content_types_for({_PRESENTATION, *parts}))
            if "" in self._raw_rels:
                out.writestr(_ROOT_RELS, self._raw_rels[""])
            out.writestr(_PRESENTATION, self._presentation_with_only(entry))
            out.writestr(_rels_name(_PRESENTATION), _serialize_rels(kept_rels))
            for part, body in parts.items():
                out.writestr(part, body)
                if part in self._raw_rels:
                    out.writestr(_rels_name(part), self._raw_rels[part])
        return buf.getvalue()

    def _closure(self, roots: list[str], excluded: AbstractSet[str]) -> list[str]:
        """XML parts reachable from the roots through relationships, never entering an excluded part."""
        seen: dict[str, None] = {}
        pending = [part for part in roots if part not in excluded]
        while pending:
            part = pending.pop()
            if part in seen:
                continue
            seen[part] = None
            pending.extend(
                rel.part
                for rel in self._relationships(part)
                if rel.part is not None and rel.part not in excluded and rel.part not in seen
            )
        return list(seen)

    def _relationships(self, part: str) -> list[_Relationship]:
        """Relationships of a part, parsed once; part "" stands for the package root."""
        if part in self._rels:
            return self._rels[part]
        rels_name = _ROOT_RELS if part == "" else _rels_name(part)
        rels: list[_Relationship] = []
        if rels_name in self._names:
            raw = self._read(rels_name)
            self._raw_rels[part] = raw
            for node in _parse(raw):
                if _local_name(node.tag) != "Relationship":
                    continue
                external = node.get("TargetMode", "Internal") == "External"
                target = node.get("Target", "")
                resolved = None if external else self._resolve(part, target)
                rels.append(_Relationship(node.get("Id", ""), node.get("Type", ""), target, external, resolved))
        self._rels[part] = rels
        return rels

    def _resolve(self, source: str, target: str) -> str | None:
        """Archive name of an internal XML target, or None if it leaves the package or is absent."""
        path = unquote(target.split("#", 1)[0])
        if not path:
            return None
        joined = path.lstrip("/") if path.startswith("/") else posixpath.join(posixpath.dirname(source), path)
        name = posixpath.normpath(joined)
        if name in (".", "..") or name.startswith(("../", "/")):
            return None
        # [Content_Types].xml is rebuilt per package and must never be copied in as a part.
        if name == _CONTENT_TYPES or not name.lower().endswith(".xml") or name not in self._names:
            return None
        return name

    def _read(self, name: str) -> bytes:
        if name in self._shared:
            return self._shared[name]
        if self._budget <= 0:
            raise ConversionError("limit_exceeded", "archive parts expand beyond the size limit")
        body = read_part(self._archive, name, self._budget)
        self._budget -= len(body)
        return body

    def _presentation_with_only(self, entry: Element) -> bytes:
        assert self._slide_id_list is not None
        self._slide_id_list.append(entry)
        try:
            return tostring(self._presentation, encoding="UTF-8", xml_declaration=True)
        finally:
            self._slide_id_list.remove(entry)

    def _content_types_for(self, parts: set[str]) -> bytes:
        lowered = {part.lower() for part in parts}
        items = []
        for node in self._content_types:
            kind = _local_name(node.tag)
            if kind == "Default":
                items.append(
                    f"<Default Extension={_attr(node, 'Extension')} ContentType={_attr(node, 'ContentType')}/>"
                )
            elif kind == "Override" and unquote(node.get("PartName", "")).lstrip("/").lower() in lowered:
                items.append(f"<Override PartName={_attr(node, 'PartName')} ContentType={_attr(node, 'ContentType')}/>")
        return _xml_document(f'<Types xmlns="{_CONTENT_TYPES_NS}">{"".join(items)}</Types>')


def _parse(body: bytes) -> Element:
    try:
        return fromstring(body)
    except _XML_ERRORS:
        raise ConversionError("malformed", "PPTX part is not well-formed XML") from None


def _register_prefixes(body: bytes) -> None:
    # Keeping the document's own prefixes avoids ns0-style renames that break mc:Ignorable lists.
    try:
        for _event, (prefix, uri) in iterparse(io.BytesIO(body), events=("start-ns",)):
            if prefix and not re.fullmatch(r"ns\d+", prefix):
                register_namespace(prefix, uri)
    except _XML_ERRORS:
        raise ConversionError("malformed", "PPTX part is not well-formed XML") from None


def _find_child(root: Element, name: str) -> Element | None:
    return next((child for child in root if _local_name(child.tag) == name), None)


def _rel_id_of(entry: Element) -> str | None:
    return next((value for key, value in entry.attrib.items() if key.endswith(_REL_ID_SUFFIX)), None)


def _is_slide(rel: _Relationship) -> bool:
    return rel.rel_type.endswith(_SLIDE_REL_SUFFIX)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _rels_name(part: str) -> str:
    return posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")


def _serialize_rels(rels: list[_Relationship]) -> bytes:
    items = "".join(
        f"<Relationship Id={quoteattr(rel.rel_id)} Type={quoteattr(rel.rel_type)} Target={quoteattr(rel.target)}"
        + (' TargetMode="External"' if rel.external else "")
        + "/>"
        for rel in rels
    )
    return _xml_document(f'<Relationships xmlns="{_RELS_NS}">{items}</Relationships>')


def _attr(node: Element, name: str) -> str:
    return quoteattr(node.get(name, ""))


def _xml_document(body: str) -> bytes:
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body).encode()
