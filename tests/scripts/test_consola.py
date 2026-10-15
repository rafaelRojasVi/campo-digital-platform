"""Local Consola runner: fetching, errors, local-only server."""

from __future__ import annotations

import json
import subprocess
import threading
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

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


def test_is_wsl() -> None:
    assert consola.is_wsl({"WSL_DISTRO_NAME": "Ubuntu"}, "")
    assert consola.is_wsl({}, "Linux version 6.18 microsoft-standard-WSL2")
    assert not consola.is_wsl({}, "Linux version 6.8.0-generic")


@pytest.mark.parametrize(
    ("wsl", "available", "expected"),
    [
        (True, {"wslview", "explorer.exe"}, ["wslview", "http://u"]),
        (True, {"explorer.exe"}, ["explorer.exe", "http://u"]),
        (False, {"xdg-open"}, ["xdg-open", "http://u"]),
        (False, set(), None),
    ],
)
def test_browser_command(wsl: bool, available: set[str], expected: list[str] | None) -> None:
    which = lambda name: f"/usr/bin/{name}" if name in available else None  # noqa: E731
    assert consola.browser_command("http://u", wsl=wsl, which=which) == expected


def test_install_and_uninstall(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "scripts" / "consola").mkdir(parents=True)
    home = tmp_path / "home"

    written = consola.install(repo, home)
    launcher = home / ".local/bin/consola"
    desktop = home / ".local/share/applications/campo-consola.desktop"
    assert set(written) == {launcher, desktop}
    assert str(repo / "scripts" / "consola.py") in launcher.read_text()
    assert launcher.stat().st_mode & 0o111
    assert "Name=Consola Campo Digital" in desktop.read_text()
    assert f"Exec={launcher}" in desktop.read_text()

    assert set(consola.uninstall(home)) == {launcher, desktop}
    assert not launcher.exists() and not desktop.exists()


def test_main_reuses_running_consola(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[str] = []
    monkeypatch.setattr(consola, "already_running", lambda url: True)
    monkeypatch.setattr(consola, "open_browser", lambda url: opened.append(url))
    monkeypatch.setattr(
        consola, "make_server", lambda *a, **k: pytest.fail("must not start a server")
    )
    assert consola.main([]) == 0
    assert opened == ["http://127.0.0.1:8787/"]


def test_page_has_every_section_and_no_external_resources() -> None:
    html = (consola.ASSETS / "index.html").read_text(encoding="utf-8")
    for section in ("Alertas", "Actividad", "IPs sospechosas", "Uso por producto", "Salud"):
        assert section in html
    assert "http://" not in html.replace("http://127.0.0.1", "")
    assert "<script src=" not in html and '<link rel="stylesheet"' not in html


def test_page_never_shows_good_news_without_data() -> None:
    """With no report (Railway failed), sections must say there is no data, not "no alerts"."""

    html = (consola.ASSETS / "index.html").read_text(encoding="utf-8")
    assert "function renderUnavailable" in html
    assert "Sin datos: revisa el aviso de arriba." in html
    assert 'aria-live="polite"' in html
