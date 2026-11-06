"""Test-only ASGI entry for live_server: the real app whose conversion child is a stand-in.

uvicorn imports this module by name (`live_apps:app`), so the stand-in must be importable in
the server process and in its forkserver; live_server puts tests/ and tests/runner/ on
PYTHONPATH for that.
"""

from __future__ import annotations

import child_targets

from app.main import create_app

app = create_app(child_target=child_targets.pid_file_then_delayed_echo_target)
