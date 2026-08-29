from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = REPO_ROOT / "products" / "transelect" / "dashboard"
TRANSELEC_SRC = REPO_ROOT / "products" / "transelect" / "src"
SOURCE_SUBDIR = Path("03_Proyecto_Transelec") / "02_Datos_Entrada"
USER_ID = getattr(os, "getuid", lambda: 0)()
STATE_KEY = hashlib.sha1(str(REPO_ROOT).encode()).hexdigest()[:10]
STATE_DIR = (
    Path(tempfile.gettempdir()) / f"campo-digital-transelec-dev-{USER_ID}-{STATE_KEY}"
)
STATE_FILE = STATE_DIR / "state.json"
BACKEND_LOG = STATE_DIR / "backend.log"
FRONTEND_LOG = STATE_DIR / "frontend.log"


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def _read_state() -> dict[str, Any] | None:
    if not STATE_FILE.is_file():
        return None
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _write_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _process_matches_cwd(pid: int, expected_cwd: Path) -> bool:
    proc_cwd = Path(f"/proc/{pid}/cwd")
    if not proc_cwd.exists():
        return False
    try:
        return proc_cwd.resolve() == expected_cwd.resolve()
    except OSError:
        return False


def _terminate_recorded_process(
    label: str,
    state: dict[str, Any],
    expected_cwd: Path,
) -> None:
    pid = int(state.get(f"{label}_pid", 0) or 0)
    if not _pid_alive(pid):
        return

    if not _process_matches_cwd(pid, expected_cwd):
        print(
            f"Refusing to stop PID {pid}: it no longer belongs to the expected "
            f"{label} working directory."
        )
        return

    try:
        process_group = os.getpgid(pid)
        os.killpg(process_group, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        return

    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            return
        time.sleep(0.1)

    try:
        os.killpg(process_group, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass


def _cleanup_state_file() -> None:
    try:
        STATE_FILE.unlink()
    except FileNotFoundError:
        pass


def _find_free_port(start: int, end: int) -> int:
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No free localhost port found in range {start}-{end}")


def _http_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return 200 <= response.status < 500
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _wait_http(url: str, process: subprocess.Popen[bytes], timeout: float = 20) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        if _http_ready(url):
            return True
        time.sleep(0.2)
    return False


def _tail(path: Path, lines: int = 30) -> str:
    if not path.is_file():
        return "(no log output)"
    content = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(content[-lines:])


def _source_roots() -> list[Path]:
    roots: list[Path] = []

    configured = os.environ.get("CAMPO_DIGITAL_SOURCE_ROOT")
    if configured:
        roots.append(Path(configured).expanduser())

    windows_users = Path("/mnt/c/Users")
    if windows_users.is_dir():
        roots.extend(
            path
            for path in windows_users.glob("*/OneDrive*/00 Hub Digital CampoDigital")
            if path.is_dir()
        )

    roots.extend(
        path
        for path in (
            Path.home() / "OneDrive" / "00 Hub Digital CampoDigital",
            Path.home() / "00 Hub Digital CampoDigital",
        )
        if path.is_dir()
    )

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            key = str(root.resolve())
        except OSError:
            key = str(root)
        if key not in seen and root.is_dir():
            seen.add(key)
            unique.append(root)

    return unique


def _candidate_workbooks(root: Path) -> list[Path]:
    preferred = root / SOURCE_SUBDIR
    search_root = preferred if preferred.is_dir() else root / "03_Proyecto_Transelec"
    if not search_root.is_dir():
        return []

    candidates = [
        path
        for path in search_root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".xlsx", ".xlsm"}
        and not path.name.startswith("~$")
    ]
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)


def _validate_workbook(path: Path) -> int:
    sys.path.insert(0, str(TRANSELEC_SRC))
    from transelec_ingestion.xlsx_contract import load_transelec_workbook

    workbook = load_transelec_workbook(path)
    return len(workbook.resumen_rows)


def _containing_root(path: Path, roots: list[Path]) -> Path | None:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(root.resolve())
        except ValueError:
            continue
        return root.resolve()
    return None


def _discover_workbook() -> tuple[Path, int, Path | None]:
    explicit = os.environ.get("CAMPO_TRANSELEC_WORKBOOK_PATH")
    roots = _source_roots()

    if explicit:
        path = Path(explicit).expanduser()
        try:
            rows = _validate_workbook(path)
        except Exception as exc:
            raise RuntimeError(
                "CAMPO_TRANSELEC_WORKBOOK_PATH is set but does not satisfy "
                f"Source Contract V1: {path}\n{exc}"
            ) from exc
        return path.resolve(), rows, _containing_root(path, roots)

    candidates: list[tuple[Path, Path]] = []
    for root in roots:
        candidates.extend((candidate, root) for candidate in _candidate_workbooks(root))

    candidates.sort(key=lambda item: item[0].stat().st_mtime, reverse=True)

    failures: list[tuple[Path, str]] = []
    for candidate, root in candidates:
        try:
            rows = _validate_workbook(candidate)
        except Exception as exc:
            failures.append((candidate, str(exc)))
            continue
        return candidate.resolve(), rows, root.resolve()

    details = ""
    if failures:
        lines = [f"- {path}: {reason}" for path, reason in failures[:5]]
        details = "\nRecent invalid candidates:\n" + "\n".join(lines)

    searched = ", ".join(str(root) for root in roots) or "(no local source root detected)"
    raise RuntimeError(
        "No contract-valid Transelec workbook was found.\n"
        f"Searched: {searched}\n"
        "Set CAMPO_DIGITAL_SOURCE_ROOT or CAMPO_TRANSELEC_WORKBOOK_PATH explicitly."
        f"{details}"
    )


def _start_process(
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    log_path: Path,
) -> subprocess.Popen[bytes]:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with log_path.open("wb") as log_file:
        return subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def _ensure_frontend_dependencies() -> None:
    if (DASHBOARD_DIR / "node_modules").is_dir():
        return
    print("Installing Transelec dashboard dependencies (npm ci)...")
    subprocess.run(["npm", "ci"], cwd=DASHBOARD_DIR, check=True)


def _open_browser(url: str) -> None:
    for command in (
        ["wslview", url],
        ["cmd.exe", "/c", "start", "", url],
        ["xdg-open", url],
    ):
        if shutil.which(command[0]):
            try:
                subprocess.Popen(
                    command,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                continue
    webbrowser.open(url)


def _state_running(state: dict[str, Any]) -> bool:
    return _pid_alive(int(state.get("backend_pid", 0) or 0)) and _pid_alive(
        int(state.get("frontend_pid", 0) or 0)
    )


def _print_state(state: dict[str, Any]) -> None:
    backend_pid = int(state.get("backend_pid", 0) or 0)
    frontend_pid = int(state.get("frontend_pid", 0) or 0)
    backend_alive = _pid_alive(backend_pid)
    frontend_alive = _pid_alive(frontend_pid)

    print("Transelec local demo")
    print(f"  Backend:  {state.get('backend_url', '—')} {'✓' if backend_alive else '✗'}")
    print(f"  Frontend: {state.get('frontend_url', '—')} {'✓' if frontend_alive else '✗'}")
    print(f"  Workbook: {state.get('workbook', '—')}")
    print(f"  Rows:     {state.get('business_rows', '—')}")
    print(f"  Logs:     {STATE_DIR}")


def command_dev() -> int:
    existing = _read_state()
    if existing and _state_running(existing):
        _print_state(existing)
        frontend_url = str(existing["frontend_url"])
        print(f"\nAlready running. Opening {frontend_url}")
        _open_browser(frontend_url)
        return 0

    if existing:
        _terminate_recorded_process("frontend", existing, DASHBOARD_DIR)
        _terminate_recorded_process("backend", existing, REPO_ROOT)
        _cleanup_state_file()

    workbook, business_rows, source_root = _discover_workbook()
    _ensure_frontend_dependencies()

    backend_port = _find_free_port(8000, 8020)
    frontend_port = _find_free_port(5173, 5190)
    backend_url = f"http://127.0.0.1:{backend_port}"
    frontend_url = f"http://127.0.0.1:{frontend_port}"

    backend_env = os.environ.copy()
    backend_env["CAMPO_TRANSELEC_WORKBOOK_PATH"] = str(workbook)
    if source_root is not None:
        backend_env.setdefault("CAMPO_DIGITAL_SOURCE_ROOT", str(source_root))
    backend_env["PYTHONUNBUFFERED"] = "1"

    backend_command = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--app-dir",
        "apps/api",
        "--host",
        "127.0.0.1",
        "--port",
        str(backend_port),
        "--reload",
    ]

    print(f"Using workbook: {workbook}")
    print(f"Validated business rows: {business_rows}")
    print(f"Starting backend on {backend_url} ...")
    backend = _start_process(backend_command, REPO_ROOT, backend_env, BACKEND_LOG)

    if not _wait_http(f"{backend_url}/health", backend):
        try:
            os.killpg(os.getpgid(backend.pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass
        print("Backend failed to become ready.\n")
        print(_tail(BACKEND_LOG))
        return 1

    frontend_env = os.environ.copy()
    frontend_env["VITE_API_PROXY_TARGET"] = backend_url
    frontend_command = [
        "npm",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        str(frontend_port),
        "--strictPort",
    ]

    print(f"Starting frontend on {frontend_url} ...")
    frontend = _start_process(frontend_command, DASHBOARD_DIR, frontend_env, FRONTEND_LOG)

    if not _wait_http(frontend_url, frontend):
        for process in (frontend, backend):
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
        print("Frontend failed to become ready.\n")
        print(_tail(FRONTEND_LOG))
        return 1

    state = {
        "backend_pid": backend.pid,
        "frontend_pid": frontend.pid,
        "backend_url": backend_url,
        "frontend_url": frontend_url,
        "workbook": str(workbook),
        "business_rows": business_rows,
        "source_root": str(source_root) if source_root else None,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    _write_state(state)

    print()
    _print_state(state)
    print(f"\nOpening {frontend_url}")
    _open_browser(frontend_url)
    return 0


def command_status() -> int:
    state = _read_state()
    if not state:
        print("Transelec local demo is not running through this worktree launcher.")
        print("Run: make transelec-dev")
        return 0
    _print_state(state)
    return 0 if _state_running(state) else 1


def command_stop() -> int:
    state = _read_state()
    if not state:
        print("No Transelec processes recorded for this worktree.")
        return 0

    _terminate_recorded_process("frontend", state, DASHBOARD_DIR)
    _terminate_recorded_process("backend", state, REPO_ROOT)
    _cleanup_state_file()
    print("Stopped Transelec processes launched by this worktree.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Local Transelec demo launcher")
    parser.add_argument("command", choices=("dev", "status", "stop"))
    args = parser.parse_args()

    try:
        if args.command == "dev":
            return command_dev()
        if args.command == "status":
            return command_status()
        return command_stop()
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
