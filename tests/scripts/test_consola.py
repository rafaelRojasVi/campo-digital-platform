"""Local Consola runner: fetching, errors, local-only server."""

from __future__ import annotations

import json
import subprocess
import threading
import urllib.request
from datetime import UTC, datetime

import pytest
from scripts import consola


def _completed(
    stdout: str = "", stderr: str = "", code: int = 0
) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=code, stdout=stdout, stderr=stderr)


def test_run_json_reads_the_last_json_line() -> None:
    out = 'Using SSH key from file ...\n{"alerts": []}\n'
    assert consola.run_json(["x"], runner=lambda *a, **k: _completed(out)) == {"alerts": []}


def test_run_json_missing_cli() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("railway")

    with pytest.raises(consola.ConsolaError, match="railway"):
        consola.run_json(["railway"], runner=runner)


def test_run_json_logged_out() -> None:
    with pytest.raises(consola.ConsolaError, match="railway login"):
        consola.run_json(
            ["x"], runner=lambda *a, **k: _completed(stderr="Unauthorized. Please login", code=1)
        )


def test_run_json_other_failure_shows_exit_code_only() -> None:
    with pytest.raises(consola.ConsolaError, match="código 2") as caught:
        consola.run_json(["x"], runner=lambda *a, **k: _completed(stderr="secret row data", code=2))
    assert "secret" not in str(caught.value)


def test_run_json_timeout() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(cmd="x", timeout=1)

    with pytest.raises(consola.ConsolaError, match="tardó"):
        consola.run_json(["x"], runner=runner)


def test_summarize_deployments() -> None:
    raw = [
        {
            "id": "94172cf4-aaaa",
            "status": "SUCCESS",
            "createdAt": "2026-10-15T18:00:00Z",
            "meta": {"commitHash": "25b4014abc", "commitMessage": "Merge pull request #98\n\nbody"},
        }
    ]
    assert consola.summarize_deployments(raw) == [
        {
            "id": "94172cf4",
            "status": "SUCCESS",
            "created_at": "2026-10-15T18:00:00Z",
            "commit": "25b4014",
            "message": "Merge pull request #98",
        }
    ]


def test_fetch_snapshot_reports_error_instead_of_raising() -> None:
    def runner(*a: object, **k: object) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("railway")

    snap = consola.fetch_snapshot(runner=runner, now=lambda: datetime(2026, 10, 15, tzinfo=UTC))
    assert snap["report"] is None
    assert "railway" in str(snap["error"])


def test_server_serves_page_and_report_on_localhost_only() -> None:
    calls: list[int] = []

    def fetch() -> dict[str, object]:
        calls.append(1)
        return {"report": {"alerts": []}, "deployments": [], "fetched_at": "t", "error": None}

    server = consola.make_server(consola.ConsolaState(fetch), b"<html>ok</html>", port=0)
    host, port = server.server_address[:2]
    assert host == "127.0.0.1"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{port}"
        assert urllib.request.urlopen(base + "/").read() == b"<html>ok</html>"
        assert json.loads(urllib.request.urlopen(base + "/api/report").read())["report"] == {
            "alerts": []
        }
        urllib.request.urlopen(base + "/api/report")  # cached
        urllib.request.urlopen(base + "/api/report?refresh=1")  # refetch
        assert len(calls) == 2
        assert json.loads(urllib.request.urlopen(base + "/api/ping").read()) == {
            "app": "campo-consola"
        }
    finally:
        server.shutdown()
