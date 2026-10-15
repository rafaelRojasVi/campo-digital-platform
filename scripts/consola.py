#!/usr/bin/env python3
"""Consola Campo Digital: local security and usage view for the operator.

Fetches a read-only report from production with the Railway CLI
(`railway ssh` running `python -m app.consola_export`), serves one page on
http://127.0.0.1:8787 and opens the browser. Standard library only, so it
runs with the system python3. Data stays in memory.

Spec: docs/superpowers/specs/2026-10-15-platform-consola-design.md.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8787
SERVICE = "campo-digital-platform"
ASSETS = Path(__file__).resolve().parent / "consola"
# The Railway CLI finds the linked project from the current folder; an
# app-menu launch starts elsewhere, so railway always runs from the repo.
REPO_ROOT = Path(__file__).resolve().parents[1]
EXPORT_COMMAND = [
    "railway",
    "ssh",
    "--service",
    SERVICE,
    "--",
    "sh",
    "-c",
    "cd /app/apps/api && /app/.venv/bin/python -m app.consola_export",
]
DEPLOYMENTS_COMMAND = ["railway", "deployment", "list", "--service", SERVICE, "--json"]
TIMEOUT_SECONDS = 120


class ConsolaError(Exception):
    """A problem the operator can act on; the message is shown on the page."""


Runner = Callable[..., "subprocess.CompletedProcess[str]"]


def run_json(command: list[str], runner: Runner = subprocess.run) -> object:
    try:
        result = runner(
            command,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=TIMEOUT_SECONDS,
            check=False,
            cwd=REPO_ROOT,
        )
    except FileNotFoundError as exc:
        raise ConsolaError(
            "No encuentro el comando railway. Instálalo con: npm install -g @railway/cli"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ConsolaError("Railway tardó demasiado en responder. Intenta de nuevo.") from exc
    if result.returncode != 0:
        stderr = (result.stderr or "").lower()
        if "no linked project" in stderr or "railway link" in stderr:
            raise ConsolaError(
                f"Railway no sabe qué proyecto usar. Corre `railway link` en {REPO_ROOT}"
            )
        if "unauthorized" in stderr or "login" in stderr:
            raise ConsolaError("Railway no tiene sesión iniciada. Corre: railway login")
        raise ConsolaError(f"El comando de Railway falló (código {result.returncode}).")
    lines = (result.stdout or "").splitlines()
    # Pretty-printed output (the deployment list) spans several lines.
    start = next((i for i, line in enumerate(lines) if line.startswith(("{", "["))), None)
    if start is not None:
        try:
            return json.loads("\n".join(lines[start:]))
        except json.JSONDecodeError:
            pass
    for line in reversed(lines):
        line = line.strip()
        if line.startswith(("{", "[")):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                break
    raise ConsolaError("Railway respondió, pero sin un reporte válido.")


def summarize_deployments(raw: object) -> list[dict[str, str]]:
    summary: list[dict[str, str]] = []
    for item in raw[:3] if isinstance(raw, list) else []:
        meta = item.get("meta") or {}
        message = (meta.get("commitMessage") or "").splitlines()
        summary.append(
            {
                "id": str(item.get("id", ""))[:8],
                "status": str(item.get("status", "")),
                "created_at": str(item.get("createdAt", "")),
                "commit": str(meta.get("commitHash") or "")[:7],
                "message": message[0] if message else "",
            }
        )
    return summary


def fetch_snapshot(
    runner: Runner = subprocess.run, now: Callable[[], datetime] = lambda: datetime.now(UTC)
) -> dict[str, object]:
    snapshot: dict[str, object] = {
        "report": None,
        "deployments": [],
        "fetched_at": now().isoformat(),
        "error": None,
        "deployments_error": None,
    }
    try:
        snapshot["report"] = run_json(EXPORT_COMMAND, runner)
    except ConsolaError as exc:
        snapshot["error"] = str(exc)
    except Exception as exc:  # noqa: BLE001 - show a message, never crash the page
        snapshot["error"] = f"Error inesperado al leer producción ({type(exc).__name__})."
    # The deployment list is secondary: its failure must not hide the report.
    try:
        snapshot["deployments"] = summarize_deployments(run_json(DEPLOYMENTS_COMMAND, runner))
    except ConsolaError as exc:
        snapshot["deployments_error"] = str(exc)
    except Exception as exc:  # noqa: BLE001
        snapshot["deployments_error"] = f"Error inesperado al leer Railway ({type(exc).__name__})."
    return snapshot


class ConsolaState:
    def __init__(self, fetch: Callable[[], dict[str, object]]) -> None:
        self._fetch = fetch
        self._lock = threading.Lock()
        self._data: dict[str, object] | None = None
        self.last_request = time.monotonic()

    def snapshot(self, refresh: bool) -> dict[str, object]:
        with self._lock:
            if refresh or self._data is None:
                self._data = self._fetch()
            return self._data


def make_server(
    state: ConsolaState, page: bytes, host: str = HOST, port: int = PORT
) -> ThreadingHTTPServer:
    allowed_hosts: set[str] = set()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: bytes, content_type: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; style-src 'self' 'unsafe-inline'; "
                "script-src 'self' 'unsafe-inline'; img-src 'self' data:",
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - http.server API
            # Only answer this machine's own names: a page rebinding its
            # domain to 127.0.0.1 (DNS rebinding) must not read the report.
            if self.headers.get("Host") not in allowed_hosts:
                self._send(403, b"Forbidden", "text/plain")
                return
            state.last_request = time.monotonic()
            url = urlparse(self.path)
            if url.path == "/":
                self._send(200, page, "text/html; charset=utf-8")
            elif url.path == "/api/report":
                refresh = parse_qs(url.query).get("refresh") == ["1"]
                # A refresh runs railway against production; only the page,
                # which sends this header, may ask for one.
                if refresh and self.headers.get("X-Consola") != "1":
                    self._send(403, b"Forbidden", "text/plain")
                    return
                body = json.dumps(state.snapshot(refresh), ensure_ascii=False).encode()
                self._send(200, body, "application/json; charset=utf-8")
            elif url.path == "/api/ping":
                self._send(200, b'{"app": "campo-consola"}', "application/json")
            elif url.path == "/icon.svg":
                self._send(200, (ASSETS / "icon.svg").read_bytes(), "image/svg+xml")
            else:
                self._send(404, b"Not found", "text/plain")

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            del format, args  # keep the terminal quiet

    server = ThreadingHTTPServer((host, port), Handler)
    bound_port = server.server_address[1]
    allowed_hosts.update({f"127.0.0.1:{bound_port}", f"localhost:{bound_port}"})
    return server


IDLE_EXIT_SECONDS = 3600
URL = f"http://{HOST}:{PORT}/"


def is_wsl(environ: Mapping[str, str], proc_version: str) -> bool:
    return "WSL_DISTRO_NAME" in environ or "microsoft" in proc_version.lower()


def browser_command(url: str, *, wsl: bool, which: Callable[[str], str | None]) -> list[str] | None:
    candidates = ["wslview", "explorer.exe"] if wsl else ["xdg-open"]
    for name in candidates:
        if which(name):
            return [name, url]
    return None


def open_browser(url: str) -> None:
    try:
        proc_version = Path("/proc/version").read_text(encoding="utf-8")
    except OSError:
        proc_version = ""
    command = browser_command(url, wsl=is_wsl(os.environ, proc_version), which=shutil.which)
    if command is None:
        print(f"Abre en tu navegador: {url}")
        return
    subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603


def already_running(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "api/ping", timeout=1) as response:  # noqa: S310 - localhost
            return json.loads(response.read()).get("app") == "campo-consola"
    except (OSError, ValueError):
        return False


_LAUNCHER = """#!/bin/sh
# Consola Campo Digital (installed by `make consola-install`).
exec python3 "{script}" "$@"
"""

_DESKTOP = """[Desktop Entry]
Type=Application
Name=Consola Campo Digital
Comment=Seguridad y uso de la plataforma Campo Digital
Exec={launcher}
Icon={icon}
Terminal=false
Categories=Development;Monitor;
"""


def install(repo_root: Path, home: Path) -> list[Path]:
    launcher = home / ".local/bin/consola"
    desktop = home / ".local/share/applications/campo-consola.desktop"
    launcher.parent.mkdir(parents=True, exist_ok=True)
    desktop.parent.mkdir(parents=True, exist_ok=True)
    launcher.write_text(
        _LAUNCHER.format(script=repo_root / "scripts" / "consola.py"), encoding="utf-8"
    )
    launcher.chmod(0o755)
    desktop.write_text(
        _DESKTOP.format(launcher=launcher, icon=repo_root / "scripts" / "consola" / "icon.svg"),
        encoding="utf-8",
    )
    return [launcher, desktop]


def uninstall(home: Path) -> list[Path]:
    removed = []
    for path in (
        home / ".local/bin/consola",
        home / ".local/share/applications/campo-consola.desktop",
    ):
        if path.exists():
            path.unlink()
            removed.append(path)
    return removed


def _demo_snapshot() -> dict[str, object]:
    return json.loads((ASSETS / "demo-report.json").read_text(encoding="utf-8"))


def _watch_idle(server: ThreadingHTTPServer, state: ConsolaState) -> None:
    while True:
        time.sleep(60)
        if time.monotonic() - state.last_request > IDLE_EXIT_SECONDS:
            server.shutdown()
            return


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    repo_root = REPO_ROOT
    if args[:1] == ["install"]:
        for path in install(repo_root, Path.home()):
            print(f"Instalado: {path}")
        print("Ábrela con el comando `consola` o desde el menú de aplicaciones.")
        return 0
    if args[:1] == ["uninstall"]:
        for path in uninstall(Path.home()):
            print(f"Eliminado: {path}")
        return 0

    if already_running(URL):
        open_browser(URL)
        return 0

    fetch = _demo_snapshot if "--demo" in args else fetch_snapshot
    state = ConsolaState(fetch)
    page = (ASSETS / "index.html").read_bytes()
    try:
        server = make_server(state, page)
    except OSError as exc:
        print(f"No pude abrir el puerto {PORT}: {exc}")
        return 1
    threading.Thread(target=_watch_idle, args=(server, state), daemon=True).start()
    print(f"Consola Campo Digital en {URL} (se cierra sola tras 1 h sin uso; Ctrl+C para salir)")
    open_browser(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
