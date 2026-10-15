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
import subprocess
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8787
SERVICE = "campo-digital-platform"
ASSETS = Path(__file__).resolve().parent / "consola"
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
            command, capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False
        )
    except FileNotFoundError as exc:
        raise ConsolaError(
            "No encuentro el comando railway. Instálalo con: npm install -g @railway/cli"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ConsolaError("Railway tardó demasiado en responder. Intenta de nuevo.") from exc
    if result.returncode != 0:
        stderr = (result.stderr or "").lower()
        if "unauthorized" in stderr or "login" in stderr:
            raise ConsolaError("Railway no tiene sesión iniciada. Corre: railway login")
        raise ConsolaError(f"El comando de Railway falló (código {result.returncode}).")
    for line in reversed((result.stdout or "").splitlines()):
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
    }
    try:
        snapshot["report"] = run_json(EXPORT_COMMAND, runner)
        snapshot["deployments"] = summarize_deployments(run_json(DEPLOYMENTS_COMMAND, runner))
    except ConsolaError as exc:
        snapshot["error"] = str(exc)
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
            state.last_request = time.monotonic()
            url = urlparse(self.path)
            if url.path == "/":
                self._send(200, page, "text/html; charset=utf-8")
            elif url.path == "/api/report":
                refresh = parse_qs(url.query).get("refresh") == ["1"]
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

    return ThreadingHTTPServer((host, port), Handler)
