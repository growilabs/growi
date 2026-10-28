"""Tests for the Settings configuration module (Task 1.2).

RED phase: these tests are written before the implementation exists.
They verify the fail-fast behaviour for ATTACHMENT_EXTRACTOR_SERVICE_TOKEN and
that all other fields have correct defaults / types.
"""

import pytest
from pydantic import ValidationError

NEW_KEYS = (
    "MAX_CHILD_RSS_MB",
    "MAX_XLSX_CELLS",
    "MAX_RESULT_BYTES",
    "MAX_PDF_PAGES",
    "MAX_ARCHIVE_ENTRIES",
    "MAX_ARCHIVE_UNCOMPRESSED_MB",
)


class TestSettingsMissingToken:
    """ATTACHMENT_EXTRACTOR_SERVICE_TOKEN is required; omitting it must raise."""

    def test_raises_when_token_not_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Instantiating Settings without the token env-var must raise ValidationError."""
        monkeypatch.delenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", raising=False)
        # Re-import after clearing env so pydantic-settings re-reads environment
        from importlib import reload

        import app.config as config_module

        reload(config_module)

        with pytest.raises(ValidationError):
            config_module.Settings()

    def test_raises_when_token_is_empty_string(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """An empty-string token must also raise ValidationError (fail fast)."""
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "")

        from importlib import reload

        import app.config as config_module

        reload(config_module)

        with pytest.raises(ValidationError):
            config_module.Settings()

    def test_raises_when_token_is_whitespace_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A whitespace-only token must also raise ValidationError (fail fast)."""
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "   ")

        from importlib import reload

        import app.config as config_module

        reload(config_module)

        with pytest.raises(ValidationError):
            config_module.Settings()


class TestSettingsDefaults:
    """When a valid token is supplied, all fields should resolve to correct defaults."""

    @pytest.fixture()
    def settings(self, monkeypatch: pytest.MonkeyPatch) -> object:
        """Return a Settings instance with only the required token set."""
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "test-secret-token")
        # Clear optional overrides to exercise defaults
        for key in ("MAX_FILE_SIZE_MB", "TIMEOUT_S", "MAX_CONCURRENCY", "LOG_LEVEL", *NEW_KEYS):
            monkeypatch.delenv(key, raising=False)

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        return config_module.Settings()

    def test_max_file_size_mb_default(self, settings: object) -> None:
        assert settings.MAX_FILE_SIZE_MB == 50  # type: ignore[attr-defined]

    def test_timeout_s_default(self, settings: object) -> None:
        assert settings.TIMEOUT_S == 55  # type: ignore[attr-defined]

    def test_max_concurrency_default(self, settings: object) -> None:
        assert settings.MAX_CONCURRENCY == 3  # type: ignore[attr-defined]

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("MAX_CHILD_RSS_MB", 320),
            ("MAX_XLSX_CELLS", 70000),
            ("MAX_RESULT_BYTES", 16 * 1024 * 1024),
            ("MAX_PDF_PAGES", 5000),
            ("MAX_ARCHIVE_ENTRIES", 10000),
            ("MAX_ARCHIVE_UNCOMPRESSED_MB", 512),
        ],
    )
    def test_new_limit_defaults(self, settings: object, name: str, expected: int) -> None:
        assert getattr(settings, name) == expected

    def test_max_extracted_bytes_is_removed(self, settings: object) -> None:
        assert not hasattr(settings, "MAX_EXTRACTED_BYTES")

    def test_log_level_default(self, settings: object) -> None:
        assert settings.LOG_LEVEL == "INFO"  # type: ignore[attr-defined]

    def test_token_is_accessible(self, settings: object) -> None:
        assert settings.ATTACHMENT_EXTRACTOR_SERVICE_TOKEN == "test-secret-token"  # type: ignore[attr-defined]


class TestSettingsTyping:
    """All numeric fields must be integers; LOG_LEVEL must be str."""

    @pytest.fixture()
    def settings(self, monkeypatch: pytest.MonkeyPatch) -> object:
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "typed-token")
        for key in ("MAX_FILE_SIZE_MB", "TIMEOUT_S", "MAX_CONCURRENCY", "LOG_LEVEL", *NEW_KEYS):
            monkeypatch.delenv(key, raising=False)

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        return config_module.Settings()

    def test_max_file_size_mb_is_int(self, settings: object) -> None:
        assert isinstance(settings.MAX_FILE_SIZE_MB, int)  # type: ignore[attr-defined]

    def test_timeout_s_is_int(self, settings: object) -> None:
        assert isinstance(settings.TIMEOUT_S, int)  # type: ignore[attr-defined]

    def test_max_concurrency_is_int(self, settings: object) -> None:
        assert isinstance(settings.MAX_CONCURRENCY, int)  # type: ignore[attr-defined]

    @pytest.mark.parametrize("name", NEW_KEYS)
    def test_new_limits_are_int(self, settings: object, name: str) -> None:
        assert isinstance(getattr(settings, name), int)

    def test_log_level_is_str(self, settings: object) -> None:
        assert isinstance(settings.LOG_LEVEL, str)  # type: ignore[attr-defined]

    def test_token_is_str(self, settings: object) -> None:
        assert isinstance(settings.ATTACHMENT_EXTRACTOR_SERVICE_TOKEN, str)  # type: ignore[attr-defined]


class TestSettingsEnvOverride:
    """Environment variables must override defaults."""

    def test_env_overrides_max_file_size_mb(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("MAX_FILE_SIZE_MB", "100")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.MAX_FILE_SIZE_MB == 100

    def test_env_overrides_timeout_s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("TIMEOUT_S", "120")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.TIMEOUT_S == 120

    def test_env_overrides_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("LOG_LEVEL", "DEBUG")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.LOG_LEVEL == "DEBUG"


class TestSettingsNewEnvOverride:
    def test_env_overrides_new_limit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("MAX_CHILD_RSS_MB", "640")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        assert config_module.Settings().MAX_CHILD_RSS_MB == 640
