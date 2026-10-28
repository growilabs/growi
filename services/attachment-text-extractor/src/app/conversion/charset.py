"""Charset detection and decoding for text-like attachments."""

import codecs

from charset_normalizer import from_bytes

# Restricting the candidates is what keeps short Shift_JIS from being
# detected as big5 (see research.md).
_CANDIDATES = ["cp932", "euc_jp", "iso2022_jp", "cp1252"]

# UTF-32 BOMs begin with the UTF-16 LE BOM, so they must be checked first.
_BOMS = [
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF32_LE, "utf-32"),
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
]

# The ISO-2022-JP check runs before strict UTF-8 because the data is pure 7-bit:
# UTF-8 would accept it and leave the escape sequences in the text.
_ISO2022JP_ESCAPES = (b"\x1b$B", b"\x1b$@", b"\x1b(J")


# The declared name is attacker-controlled (HTML meta), and Python's codec
# registry also holds non-charset codecs that would yield mojibake.
_NON_CHARSET_CODECS = frozenset({"unicode_escape", "raw_unicode_escape", "undefined", "punycode", "idna", "utf_7"})


def _is_usable_declared(name: str) -> bool:
    try:
        info = codecs.lookup(name)
    except (LookupError, ValueError):
        return False
    return info._is_text_encoding and info.name.replace("-", "_") not in _NON_CHARSET_CODECS


def _try_decode(data: bytes, encoding: str) -> str | None:
    try:
        return data.decode(encoding)
    except (LookupError, ValueError):
        return None


def decode(data: bytes, declared: str | None = None) -> str:
    """BOM → declared (HTML meta) → strict UTF-8 → charset-normalizer restricted to
    cp932/euc_jp/iso2022_jp/cp1252 → cp932 → latin-1."""
    for bom, encoding in _BOMS:
        if data.startswith(bom):
            decoded = _try_decode(data, encoding)
            if decoded is not None:
                return decoded

    if declared and _is_usable_declared(declared.strip()):
        decoded = _try_decode(data, declared.strip())
        if decoded is not None:
            return decoded

    if any(escape in data for escape in _ISO2022JP_ESCAPES):
        decoded = _try_decode(data, "iso2022_jp")
        if decoded is not None:
            return decoded

    decoded = _try_decode(data, "utf-8")
    if decoded is not None:
        return decoded

    best = from_bytes(data, cp_isolation=_CANDIDATES).best()
    if best is not None:
        return str(best)

    decoded = _try_decode(data, "cp932")
    if decoded is not None:
        return decoded

    return data.decode("latin-1")
