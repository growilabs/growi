"""Linux-only limits the conversion child sets on itself; no-ops on other platforms (design: ChildEntry).

They are last-resort backstops: the parent's RSS monitor and deadline SIGKILL are the primary guards.
"""

from __future__ import annotations

import logging
import math
import signal
import sys
from dataclasses import dataclass
from typing import Final

logger = logging.getLogger(__name__)

MIB: Final = 1024 * 1024
ADDRESS_SPACE_HEADROOM_MB: Final = 512
CPU_TIME_HEADROOM_S: Final = 5
# Hard must stay above soft: at the soft limit the kernel sends SIGXCPU (classified as timeout),
# at the hard limit it sends SIGKILL (indistinguishable from a crash).
CPU_HARD_EXTRA_S: Final = 5
OOM_SCORE_ADJ: Final = 1000
RLIM_INFINITY: Final = -1  # Same value as resource.RLIM_INFINITY on Linux; resource is POSIX-only.


@dataclass(frozen=True)
class GuardResult:
    name: str
    applied: bool
    reason: str | None = None


def address_space_limit_bytes(max_child_rss_mb: int) -> int:
    return (max_child_rss_mb + ADDRESS_SPACE_HEADROOM_MB) * MIB


def cpu_time_limits(timeout_s: float) -> tuple[int, int]:
    soft = math.ceil(timeout_s) + CPU_TIME_HEADROOM_S
    return soft, soft + CPU_HARD_EXTRA_S


def clamp_to_hard_limit(soft: int, hard: int, current_hard: int) -> tuple[int, int]:
    """An unprivileged process cannot raise its hard limit, so never ask for more than it has."""
    if current_hard == RLIM_INFINITY:
        return soft, hard
    return min(soft, current_hard), min(hard, current_hard)


def apply_child_guards(max_child_rss_mb: int, timeout_s: float) -> tuple[GuardResult, ...]:
    """Must run in the child's main thread (signal disposition), before the file is read."""
    if sys.platform != "linux":
        return tuple(
            GuardResult(name, False, "not linux")
            for name in ("address_space", "cpu_time", "core_dump", "oom_score_adj")
        )
    return _apply_linux_guards(max_child_rss_mb, timeout_s)


def _apply_linux_guards(max_child_rss_mb: int, timeout_s: float) -> tuple[GuardResult, ...]:
    import resource

    address_space = address_space_limit_bytes(max_child_rss_mb)
    results = (
        _set_rlimit("address_space", resource.RLIMIT_AS, address_space, address_space),
        _set_rlimit("cpu_time", resource.RLIMIT_CPU, *cpu_time_limits(timeout_s)),
        # SIGXCPU / abort / segfault dump core by default, and a piped core_pattern hands the dump
        # (with the user's file in it) to the host even on a read-only rootfs.
        _set_rlimit("core_dump", resource.RLIMIT_CORE, 0, 0),
        # Last on purpose: tests poll oom_score_adj as the sign that every guard is in place.
        _raise_oom_score_adj(),
    )
    # A Python-level handler would never run while the main thread is inside native code.
    signal.signal(signal.SIGXCPU, signal.SIG_DFL)
    for result in results:
        if not result.applied:
            logger.warning("child guard %s was not applied: %s", result.name, result.reason)
    return results


def _set_rlimit(name: str, which: int, soft: int, hard: int) -> GuardResult:
    import resource

    try:
        _, current_hard = resource.getrlimit(which)
        resource.setrlimit(which, clamp_to_hard_limit(soft, hard, current_hard))
    except (OSError, ValueError) as exc:
        return GuardResult(name, False, type(exc).__name__)
    return GuardResult(name, True)


def _raise_oom_score_adj() -> GuardResult:
    # Raising (never lowering) the score needs no privilege; it makes the kernel pick this child
    # over the uvicorn worker when the container runs out of memory.
    try:
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write(str(OOM_SCORE_ADJ))
    except OSError as exc:
        return GuardResult("oom_score_adj", False, type(exc).__name__)
    return GuardResult("oom_score_adj", True)
