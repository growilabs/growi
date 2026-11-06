"""Office-family conversion through anydoc (Req 1.5, 1.7, 1.8, 1.10, 1.11, 2.6)."""

import re

import anydoc

from app.conversion.errors import ConversionError, FailureKind
from app.conversion.formats import AnydocFormat

# Checked in order: every class here derives from anydoc.ConvertError.
_KIND_BY_ERROR: tuple[tuple[type[BaseException], FailureKind, str], ...] = (
    (anydoc.EncryptedError, "encrypted", "document is encrypted"),
    (anydoc.ResourceLimitError, "limit_exceeded", "document exceeds a resource limit"),
    (anydoc.MalformedError, "malformed", "document is malformed"),
    (anydoc.MissingPartError, "malformed", "document is missing a required part"),
    (anydoc.UnsupportedError, "unsupported", "document uses an unsupported variant"),
)

# anydoc messages may quote input bytes or archive member names, so only the limit's own
# identifier, e.g. "(max_xml_depth)", is carried over into the detail.
_LIMIT_NAME = re.compile(r"\((max_[a-z_]+)\)")


def convert_office(data: bytes, fmt: AnydocFormat) -> str:
    """Convert with an explicit format; raise ConversionError whose detail never contains file content."""
    try:
        # No `ocr` argument: anything but the default can send the document to a hosted service.
        return anydoc.to_markdown_bytes(data, fmt)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as exc:  # Rust panics surface as pyo3_runtime.PanicException (BaseException).
        raise _classify(exc) from None


def _classify(exc: BaseException) -> ConversionError:
    for error_type, kind, detail in _KIND_BY_ERROR:
        if isinstance(exc, error_type):
            if kind == "limit_exceeded" and (match := _LIMIT_NAME.search(str(exc))):
                detail = f"{detail}: {match.group(1)}"
            return ConversionError(kind, detail)
    return ConversionError("internal", f"unexpected {type(exc).__name__} from anydoc")
