"""Tests for scripts/lidar_dev.py's adopt-vs-start decisions.

Process spawning and HTTP waits are monkeypatched at the module level so
these tests run fast and never start a real uvicorn/vite process.
"""

from __future__ import annotations

import pytest
from scripts import lidar_dev
from scripts._local_process import ManagedProcess


def test_start_api_adopts_an_already_running_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = ManagedProcess(name="api", pid=123, port=8000, marker="m")

    monkeypatch.setattr(lidar_dev, "load_process", lambda _dir, _name: existing)
    monkeypatch.setattr(lidar_dev, "is_ours", lambda _p: True)

    def fail_if_spawned(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("must not spawn a new API when one is already running")

    monkeypatch.setattr(lidar_dev, "spawn", fail_if_spawned)

    port, pid = lidar_dev.start_api()

    assert (port, pid) == (8000, 123)


def test_start_api_spawns_a_new_process_when_none_is_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(lidar_dev, "load_process", lambda _dir, _name: None)
    monkeypatch.setattr(lidar_dev, "find_free_port", lambda _preferred: 8123)

    spawned = ManagedProcess(name="api", pid=555, port=8123, marker="m")
    monkeypatch.setattr(lidar_dev, "spawn", lambda *a, **k: spawned)
    monkeypatch.setattr(lidar_dev, "wait_for_http", lambda _url, _timeout: True)

    port, pid = lidar_dev.start_api()

    assert (port, pid) == (8123, 555)


def test_start_api_raises_when_it_never_becomes_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lidar_dev, "load_process", lambda _dir, _name: None)
    monkeypatch.setattr(lidar_dev, "find_free_port", lambda _preferred: 8123)
    monkeypatch.setattr(lidar_dev, "spawn", lambda *a, **k: ManagedProcess("api", 555, 8123, "m"))
    monkeypatch.setattr(lidar_dev, "wait_for_http", lambda _url, _timeout: False)

    with pytest.raises(lidar_dev.LauncherError):
        lidar_dev.start_api()


def test_command_stop_stops_both_recorded_processes_in_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    order: list[str] = []

    def fake_stop(_dir: object, name: str) -> str:
        order.append(name)
        return f"stopped {name}"

    monkeypatch.setattr(lidar_dev, "stop_process", fake_stop)

    assert lidar_dev.command_stop() == 0
    assert order == ["viewer", "api"]
