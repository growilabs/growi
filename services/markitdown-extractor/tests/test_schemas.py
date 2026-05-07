"""Tests for Pydantic schema definitions (Task 1.3).

RED phase: these tests are written before the implementation exists.
They verify that all schema classes are correctly defined and produce
the expected JSON Schema output.
"""

import json
from enum import Enum

import pytest
from pydantic import ValidationError


class TestPageInfo:
    """PageInfo model must have pageNumber, label, and content fields."""

    def test_imports_successfully(self) -> None:
        """PageInfo must be importable from app.schemas."""
        from app.schemas import PageInfo  # noqa: F401

    def test_pageNumber_is_optional_int(self) -> None:
        """pageNumber must accept int or None."""
        from app.schemas import PageInfo

        p = PageInfo(pageNumber=1, label="Page 1", content="text")
        assert p.pageNumber == 1

        p_none = PageInfo(pageNumber=None, label=None, content="text")
        assert p_none.pageNumber is None

    def test_label_is_optional_str(self) -> None:
        """label must accept str or None."""
        from app.schemas import PageInfo

        p = PageInfo(pageNumber=1, label="Slide 1", content="text")
        assert p.label == "Slide 1"

        p_none = PageInfo(pageNumber=None, label=None, content="text")
        assert p_none.label is None

    def test_content_is_required_str(self) -> None:
        """content must be a required string field."""
        from app.schemas import PageInfo

        p = PageInfo(pageNumber=None, label=None, content="## Heading\n\nBody text")
        assert p.content == "## Heading\n\nBody text"

    def test_content_is_required_raises_without_it(self) -> None:
        """Omitting content must raise ValidationError."""
        from app.schemas import PageInfo

        with pytest.raises(ValidationError):
            PageInfo(pageNumber=1, label="Page 1")  # type: ignore[call-arg]

    def test_pageNumber_field_in_json_schema(self) -> None:
        """pageNumber must appear in the JSON Schema."""
        from app.schemas import PageInfo

        schema = PageInfo.model_json_schema()
        assert "pageNumber" in schema["properties"]

    def test_label_field_in_json_schema(self) -> None:
        """label must appear in the JSON Schema."""
        from app.schemas import PageInfo

        schema = PageInfo.model_json_schema()
        assert "label" in schema["properties"]

    def test_content_field_in_json_schema(self) -> None:
        """content must appear in the JSON Schema."""
        from app.schemas import PageInfo

        schema = PageInfo.model_json_schema()
        assert "content" in schema["properties"]


class TestExtractResponse:
    """ExtractResponse model must have pages, mimeType, and extractedCharacters."""

    def test_imports_successfully(self) -> None:
        """ExtractResponse must be importable from app.schemas."""
        from app.schemas import ExtractResponse  # noqa: F401

    def test_pages_field_is_list_of_page_info(self) -> None:
        """pages must be a list of PageInfo objects."""
        from app.schemas import ExtractResponse, PageInfo

        page = PageInfo(pageNumber=1, label="Page 1", content="text")
        r = ExtractResponse(pages=[page], mimeType="application/pdf", extractedCharacters=4)
        assert len(r.pages) == 1
        assert r.pages[0].content == "text"

    def test_pages_can_be_empty_list(self) -> None:
        """pages must accept an empty list."""
        from app.schemas import ExtractResponse

        r = ExtractResponse(pages=[], mimeType="application/pdf", extractedCharacters=0)
        assert r.pages == []

    def test_mimeType_is_str(self) -> None:
        """mimeType must be a string."""
        from app.schemas import ExtractResponse

        r = ExtractResponse(pages=[], mimeType="text/plain", extractedCharacters=0)
        assert r.mimeType == "text/plain"

    def test_extractedCharacters_is_int(self) -> None:
        """extractedCharacters must be an integer."""
        from app.schemas import ExtractResponse

        r = ExtractResponse(pages=[], mimeType="text/plain", extractedCharacters=1234)
        assert r.extractedCharacters == 1234
        assert isinstance(r.extractedCharacters, int)

    def test_json_schema_contains_pages(self) -> None:
        """JSON Schema must include 'pages' in properties."""
        from app.schemas import ExtractResponse

        schema = ExtractResponse.model_json_schema()
        assert "pages" in schema["properties"]

    def test_json_schema_contains_mimeType(self) -> None:
        """JSON Schema must include 'mimeType' in properties."""
        from app.schemas import ExtractResponse

        schema = ExtractResponse.model_json_schema()
        assert "mimeType" in schema["properties"]

    def test_json_schema_contains_extractedCharacters(self) -> None:
        """JSON Schema must include 'extractedCharacters' in properties."""
        from app.schemas import ExtractResponse

        schema = ExtractResponse.model_json_schema()
        assert "extractedCharacters" in schema["properties"]

    def test_json_schema_is_valid_json(self) -> None:
        """model_json_schema() output must be JSON-serializable."""
        from app.schemas import ExtractResponse

        schema = ExtractResponse.model_json_schema()
        serialized = json.dumps(schema)
        assert isinstance(serialized, str)


class TestErrorCode:
    """ErrorCode enum must define all 6 required values as str-based enum."""

    def test_imports_successfully(self) -> None:
        """ErrorCode must be importable from app.schemas."""
        from app.schemas import ErrorCode  # noqa: F401

    def test_is_str_enum(self) -> None:
        """ErrorCode must extend str and Enum."""
        from app.schemas import ErrorCode

        assert issubclass(ErrorCode, str)
        assert issubclass(ErrorCode, Enum)

    def test_has_unauthorized(self) -> None:
        """ErrorCode must have 'unauthorized' member with string value."""
        from app.schemas import ErrorCode

        assert ErrorCode.unauthorized == "unauthorized"

    def test_has_unsupported_format(self) -> None:
        """ErrorCode must have 'unsupported_format' member."""
        from app.schemas import ErrorCode

        assert ErrorCode.unsupported_format == "unsupported_format"

    def test_has_file_too_large(self) -> None:
        """ErrorCode must have 'file_too_large' member."""
        from app.schemas import ErrorCode

        assert ErrorCode.file_too_large == "file_too_large"

    def test_has_extraction_timeout(self) -> None:
        """ErrorCode must have 'extraction_timeout' member."""
        from app.schemas import ErrorCode

        assert ErrorCode.extraction_timeout == "extraction_timeout"

    def test_has_service_busy(self) -> None:
        """ErrorCode must have 'service_busy' member."""
        from app.schemas import ErrorCode

        assert ErrorCode.service_busy == "service_busy"

    def test_has_extraction_failed(self) -> None:
        """ErrorCode must have 'extraction_failed' member."""
        from app.schemas import ErrorCode

        assert ErrorCode.extraction_failed == "extraction_failed"

    def test_exactly_six_members(self) -> None:
        """ErrorCode must have exactly 6 members."""
        from app.schemas import ErrorCode

        assert len(list(ErrorCode)) == 6

    def test_all_values_are_strings(self) -> None:
        """All ErrorCode values must be strings (JSON-serializable as-is)."""
        from app.schemas import ErrorCode

        for member in ErrorCode:
            assert isinstance(member.value, str)


class TestErrorResponse:
    """ErrorResponse model must have code and message fields."""

    def test_imports_successfully(self) -> None:
        """ErrorResponse must be importable from app.schemas."""
        from app.schemas import ErrorResponse  # noqa: F401

    def test_code_is_error_code(self) -> None:
        """code must accept an ErrorCode value."""
        from app.schemas import ErrorCode, ErrorResponse

        r = ErrorResponse(code=ErrorCode.unauthorized, message="Unauthorized")
        assert r.code == ErrorCode.unauthorized

    def test_message_is_str(self) -> None:
        """message must be a string."""
        from app.schemas import ErrorCode, ErrorResponse

        r = ErrorResponse(code=ErrorCode.extraction_failed, message="Extraction error occurred")
        assert r.message == "Extraction error occurred"
        assert isinstance(r.message, str)

    def test_code_validates_enum_members(self) -> None:
        """code must reject values not in ErrorCode."""
        from app.schemas import ErrorResponse

        with pytest.raises(ValidationError):
            ErrorResponse(code="invalid_code", message="msg")  # type: ignore[arg-type]

    def test_json_schema_contains_code(self) -> None:
        """JSON Schema must include 'code' in properties."""
        from app.schemas import ErrorResponse

        schema = ErrorResponse.model_json_schema()
        assert "code" in schema["properties"]

    def test_json_schema_contains_message(self) -> None:
        """JSON Schema must include 'message' in properties."""
        from app.schemas import ErrorResponse

        schema = ErrorResponse.model_json_schema()
        assert "message" in schema["properties"]

    def test_serializes_to_json_with_string_code(self) -> None:
        """Serialized JSON must represent code as a string, not an object."""
        from app.schemas import ErrorCode, ErrorResponse

        r = ErrorResponse(code=ErrorCode.file_too_large, message="File too large")
        data = r.model_dump()
        assert data["code"] == "file_too_large"


class TestSchemaIntegration:
    """Integration tests verifying the complete schema contract."""

    def test_extract_response_json_schema_has_all_three_top_level_fields(self) -> None:
        """Completion criterion: ExtractResponse.model_json_schema() must include pages, mimeType, extractedCharacters."""
        from app.schemas import ExtractResponse

        schema = ExtractResponse.model_json_schema()
        props = schema["properties"]
        assert "pages" in props
        assert "mimeType" in props
        assert "extractedCharacters" in props

    def test_error_code_all_six_values(self) -> None:
        """Completion criterion: ErrorCode must have exactly 6 values."""
        from app.schemas import ErrorCode

        values = {member.value for member in ErrorCode}
        expected = {
            "unauthorized",
            "unsupported_format",
            "file_too_large",
            "extraction_timeout",
            "service_busy",
            "extraction_failed",
        }
        assert values == expected

    def test_full_response_round_trip(self) -> None:
        """A complete ExtractResponse can be serialized and deserialized."""
        from app.schemas import ExtractResponse, PageInfo

        pages = [
            PageInfo(pageNumber=1, label="Slide 1", content="# Title\n\nContent"),
            PageInfo(pageNumber=2, label="Slide 2", content="More content"),
            PageInfo(pageNumber=None, label=None, content="No page concept"),
        ]
        response = ExtractResponse(
            pages=pages,
            mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            extractedCharacters=sum(len(p.content) for p in pages),
        )
        data = json.loads(response.model_dump_json())
        assert len(data["pages"]) == 3
        assert data["mimeType"].startswith("application/")
        assert isinstance(data["extractedCharacters"], int)
