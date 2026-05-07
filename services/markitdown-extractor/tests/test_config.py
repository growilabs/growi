"""Tests for the Settings configuration module (Task 1.2).

RED phase: these tests are written before the implementation exists.
They verify the fail-fast behaviour for MARKITDOWN_SERVICE_TOKEN and
that all other fields have correct defaults / types.
"""

import pytest
from pydantic import ValidationError


class TestSettingsMissingToken:
    """MARKITDOWN_SERVICE_TOKEN is required; omitting it must raise."""

    def test_raises_when_token_not_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Instantiating Settings without the token env-var must raise ValidationError."""
        monkeypatch.delenv("MARKITDOWN_SERVICE_TOKEN", raising=False)
        # Re-import after clearing env so pydantic-settings re-reads environment
        from importlib import reload

        import app.config as config_module

        reload(config_module)

        with pytest.raises(ValidationError):
            config_module.Settings()

    def test_raises_when_token_is_empty_string(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """An empty-string token must also raise ValidationError (fail fast)."""
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "")

        from importlib import reload

        import app.config as config_module

        reload(config_module)

        with pytest.raises(ValidationError):
            config_module.Settings()

    def test_raises_when_token_is_whitespace_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A whitespace-only token must also raise ValidationError (fail fast)."""
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "   ")

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
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "test-secret-token")
        # Clear optional overrides to exercise defaults
        for key in ("MAX_FILE_SIZE_MB", "TIMEOUT_S", "MAX_CONCURRENCY", "MAX_EXTRACTED_BYTES", "LOG_LEVEL"):
            monkeypatch.delenv(key, raising=False)

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        return config_module.Settings()

    def test_max_file_size_mb_default(self, settings: object) -> None:
        assert settings.MAX_FILE_SIZE_MB == 50  # type: ignore[attr-defined]

    def test_timeout_s_default(self, settings: object) -> None:
        assert settings.TIMEOUT_S == 60  # type: ignore[attr-defined]

    def test_max_concurrency_default_is_at_least_2(self, settings: object) -> None:
        assert settings.MAX_CONCURRENCY >= 2  # type: ignore[attr-defined]

    def test_max_extracted_bytes_default(self, settings: object) -> None:
        assert settings.MAX_EXTRACTED_BYTES == 500 * 1024 * 1024  # type: ignore[attr-defined]

    def test_log_level_default(self, settings: object) -> None:
        assert settings.LOG_LEVEL == "INFO"  # type: ignore[attr-defined]

    def test_token_is_accessible(self, settings: object) -> None:
        assert settings.MARKITDOWN_SERVICE_TOKEN == "test-secret-token"  # type: ignore[attr-defined]


class TestSettingsTyping:
    """All numeric fields must be integers; LOG_LEVEL must be str."""

    @pytest.fixture()
    def settings(self, monkeypatch: pytest.MonkeyPatch) -> object:
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "typed-token")
        for key in ("MAX_FILE_SIZE_MB", "TIMEOUT_S", "MAX_CONCURRENCY", "MAX_EXTRACTED_BYTES", "LOG_LEVEL"):
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

    def test_max_extracted_bytes_is_int(self, settings: object) -> None:
        assert isinstance(settings.MAX_EXTRACTED_BYTES, int)  # type: ignore[attr-defined]

    def test_log_level_is_str(self, settings: object) -> None:
        assert isinstance(settings.LOG_LEVEL, str)  # type: ignore[attr-defined]

    def test_token_is_str(self, settings: object) -> None:
        assert isinstance(settings.MARKITDOWN_SERVICE_TOKEN, str)  # type: ignore[attr-defined]


class TestSettingsEnvOverride:
    """Environment variables must override defaults."""

    def test_env_overrides_max_file_size_mb(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("MAX_FILE_SIZE_MB", "100")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.MAX_FILE_SIZE_MB == 100

    def test_env_overrides_timeout_s(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("TIMEOUT_S", "120")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.TIMEOUT_S == 120

    def test_env_overrides_log_level(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("MARKITDOWN_SERVICE_TOKEN", "tok")
        monkeypatch.setenv("LOG_LEVEL", "DEBUG")

        from importlib import reload

        import app.config as config_module

        reload(config_module)
        s = config_module.Settings()
        assert s.LOG_LEVEL == "DEBUG"
