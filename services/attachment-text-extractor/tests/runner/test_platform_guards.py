"""Linux-only child guards (RLIMIT_AS, RLIMIT_CPU, oom_score_adj) and their no-op elsewhere (Req 2.5, 2.6).

The guards lower hard limits irreversibly, so they are only ever applied inside a child process,
never in the pytest process itself.
"""

import multiprocessing
import sys

import pytest

from app.runner import platform_guards

MIB = 1024 * 1024


def test_address_space_limit_is_rss_limit_plus_512mb():
    assert platform_guards.address_space_limit_bytes(320) == (320 + 512) * MIB


@pytest.mark.parametrize(("timeout_s", "soft"), [(55, 60), (0.3, 6), (1.0, 6), (54.2, 60)])
def test_cpu_soft_limit_is_timeout_plus_5s_and_hard_stays_above_it(timeout_s: float, soft: int):
    # hard > soft so the kernel sends SIGXCPU (classified as timeout) before SIGKILL.
    assert platform_guards.cpu_time_limits(timeout_s) == (soft, soft + 5)


def test_limits_never_exceed_an_existing_hard_limit():
    assert platform_guards.clamp_to_hard_limit(100, 105, current_hard=50) == (50, 50)
    assert platform_guards.clamp_to_hard_limit(100, 105, current_hard=103) == (100, 103)
    infinity = platform_guards.RLIM_INFINITY
    assert platform_guards.clamp_to_hard_limit(100, 105, current_hard=infinity) == (100, 105)


def test_guards_are_no_ops_outside_linux(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    touched: list[str] = []
    monkeypatch.setattr(platform_guards, "_apply_linux_guards", lambda *_: touched.append("linux"))

    results = platform_guards.apply_child_guards(max_child_rss_mb=320, timeout_s=55)

    assert touched == []
    assert {r.name for r in results} == {"address_space", "cpu_time", "core_dump", "oom_score_adj"}
    assert all(not r.applied for r in results)


def _apply_and_report(conn, max_child_rss_mb: int, timeout_s: float) -> None:  # noqa: ANN001
    results = platform_guards.apply_child_guards(max_child_rss_mb, timeout_s)
    with open("/proc/self/limits") as limits, open("/proc/self/oom_score_adj") as adj:
        conn.send(([(r.name, r.applied) for r in results], limits.read(), adj.read().strip()))
    conn.close()


def _limit_row(limits_text: str, name: str) -> tuple[str, str]:
    row = next(line for line in limits_text.splitlines() if line.startswith(name))
    soft, hard = row[len(name) :].split()[:2]
    return soft, hard


@pytest.mark.skipif(sys.platform != "linux", reason="RLIMIT_AS / oom_score_adj are Linux-only")
def test_guards_are_visible_in_proc_inside_a_child_process():
    ctx = multiprocessing.get_context("forkserver")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_apply_and_report, args=(sender, 320, 55))
    process.start()
    sender.close()
    try:
        assert receiver.poll(30), "child did not report its limits"
        results, limits_text, oom_score_adj = receiver.recv()
    finally:
        process.join(10)
        if process.is_alive():
            process.kill()
            process.join(5)

    assert dict(results) == {"address_space": True, "cpu_time": True, "core_dump": True, "oom_score_adj": True}
    expected_as = str((320 + 512) * MIB)
    assert _limit_row(limits_text, "Max address space") == (expected_as, expected_as)
    assert _limit_row(limits_text, "Max cpu time") == ("60", "65")
    # A core dump would copy the user's file contents out of the child (core_pattern may pipe to the host).
    assert _limit_row(limits_text, "Max core file size") == ("0", "0")
    assert oom_score_adj == "1000"
