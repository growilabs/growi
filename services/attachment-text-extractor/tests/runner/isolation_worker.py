"""Stand-in for a uvicorn worker, run as its own process by test_child_isolation.

Starts a ConversionRunner, keeps one real conversion running, prints
"<forkserver pid> <child pid>" once the child is busy converting, then waits to be killed.
Usage: python isolation_worker.py <file to convert>
"""

from __future__ import annotations

import asyncio
import multiprocessing.forkserver
import sys
import time
from pathlib import Path

import child_targets

from app.config import Settings
from app.runner.conversion_runner import ConversionRequest, ConversionRunner

_WAIT_S = 20.0
# An idle child sits near 80 MB; above this it is inside the conversion.
_BUSY_RSS_KIB = 110 * 1024


def _children(forkserver_pid: int) -> list[int]:
    children: list[int] = []
    for task in Path(f"/proc/{forkserver_pid}/task").iterdir():
        children.extend(int(c) for c in (task / "children").read_text().split())
    return children


def _rss_kib(pid: int) -> int:
    try:
        status = Path(f"/proc/{pid}/status").read_text()
    except OSError:
        return 0
    line = next((line for line in status.splitlines() if line.startswith("VmRSS:")), None)
    return int(line.split()[1]) if line else 0


async def main(path: Path) -> None:
    runner = ConversionRunner.from_settings(Settings(), child_target=child_targets.convert_forever_target)
    await runner.start()
    task = asyncio.ensure_future(runner.run(ConversionRequest(path.read_bytes(), path.name, None)))
    forkserver_pid = multiprocessing.forkserver._forkserver._forkserver_pid
    deadline = time.monotonic() + _WAIT_S
    while time.monotonic() < deadline and not task.done():
        busy = [pid for pid in _children(forkserver_pid) if _rss_kib(pid) > _BUSY_RSS_KIB]
        if busy:
            print(forkserver_pid, busy[0], flush=True)
            break
        await asyncio.sleep(0.01)
    else:
        print("no busy child", flush=True)
        return
    await asyncio.wait({task}, timeout=_WAIT_S)


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
