"""ZIP pre-check run before any OOXML part is parsed (Req 2.6)."""

import io
import lzma
import zipfile
import zlib
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from typing import BinaryIO

from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits

_MIB = 1024 * 1024
_COPY_CHUNK_BYTES = 64 * 1024

# Raised by zipfile while reading headers or decoding data of damaged or exotic archives.
_UNREADABLE_ARCHIVE_ERRORS = (zipfile.BadZipFile, NotImplementedError, UnicodeDecodeError, ValueError, EOFError)
# bzip2 reports corrupt streams as OSError and LZMA as its own Exception subclass.
_UNREADABLE_PART_ERRORS = (KeyError, zlib.error, OSError, lzma.LZMAError, *_UNREADABLE_ARCHIVE_ERRORS)


def inspect_archive(data: bytes, required_part: str, limits: ConversionLimits) -> zipfile.ZipFile | None:
    """Returns None when the bytes are not a ZIP with the required part (caller falls back to anydoc as-is).

    The caller owns the returned archive and must close it. Parts are only ever read in memory, never extracted.
    """
    if not zipfile.is_zipfile(io.BytesIO(data)):
        return None
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except _UNREADABLE_ARCHIVE_ERRORS:
        # Packages this reader cannot open are left to anydoc, which reports them as malformed.
        return None
    try:
        _enforce_limits(archive, limits)
        if _has_single_part(archive, required_part):
            return archive
    except BaseException:
        archive.close()
        raise
    archive.close()
    return None


def read_part(archive: zipfile.ZipFile, name: str, max_bytes: int) -> bytes:
    """Read one part, counting bytes actually decompressed rather than trusting the header sizes."""
    with _part_errors(archive, name), archive.open(name) as part:
        body = part.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ConversionError("limit_exceeded", "archive part exceeds the per-part size limit")
    return body


def copy_part(archive: zipfile.ZipFile, name: str, dest: BinaryIO, max_bytes: int) -> int:
    """Copy one part into dest a chunk at a time and return the bytes copied (decompressed, not declared)."""
    copied = 0
    with _part_errors(archive, name), archive.open(name) as part:
        while chunk := part.read(min(_COPY_CHUNK_BYTES, max_bytes - copied + 1)):
            copied += len(chunk)
            if copied > max_bytes:
                raise ConversionError("limit_exceeded", "archive part exceeds the per-part size limit")
            dest.write(chunk)
    return copied


@contextmanager
def _part_errors(archive: zipfile.ZipFile, name: str) -> Iterator[None]:
    try:
        yield
    except RuntimeError as exc:
        # zipfile raises a bare RuntimeError for both the ZIP-layer encryption flag (bit 0) and,
        # on some versions, unsupported compression methods, so the entry flag decides.
        if _is_zip_encrypted(archive, name):
            raise ConversionError("encrypted", "archive part is encrypted") from exc
        raise ConversionError("malformed", "archive part could not be read") from exc
    except _UNREADABLE_PART_ERRORS as exc:
        raise ConversionError("malformed", "archive part could not be read") from exc


def _is_zip_encrypted(archive: zipfile.ZipFile, name: str) -> bool:
    try:
        return bool(archive.getinfo(name).flag_bits & 0x1)
    except KeyError:
        return False


def _enforce_limits(archive: zipfile.ZipFile, limits: ConversionLimits) -> None:
    infos = archive.infolist()
    if len(infos) > limits.max_archive_entries:
        raise ConversionError("limit_exceeded", "archive has too many entries")
    # Declared sizes are enough here: CPython stops at the declared size and fails the CRC check beyond it.
    declared = sum(info.file_size for info in infos)
    if declared > limits.max_archive_uncompressed_mb * _MIB:
        raise ConversionError("limit_exceeded", "archive expands beyond the size limit")


def _has_single_part(archive: zipfile.ZipFile, name: str) -> bool:
    # A duplicated name is ambiguous between readers, so it is handed to anydoc untouched.
    return Counter(info.filename for info in archive.infolist())[name] == 1
