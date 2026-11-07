"""Start the qPCR Analysis Workbench on this computer and open it in the browser."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
import tomllib
import urllib.request
import webbrowser
from importlib import metadata
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend import APP_NAME, __version__
from backend.web_interface import find_web_interface, mount_web_interface

HOST = "127.0.0.1"
LOCAL_HOSTS = ["127.0.0.1", "localhost"]
DEFAULT_PORT = 8002
DEFAULT_DATA_DIR = Path.home() / ".qpcr-workbench"
PACKAGE_DIR = Path(__file__).resolve().parent
DISTRIBUTION = "qpcr-workbench"
_REQUIREMENT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
# Proxy settings (common on institutional Windows PCs) must not intercept requests to this computer.
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="qpcr-workbench", description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="local port (default: %(default)s)")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR,
                        help="folder for the database and preserved uploads (default: %(default)s)")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    return args


def storage_environment(data_dir: Path) -> dict[str, str]:
    # Same layout as backend/ in a source checkout, so --data-dir can point at existing data.
    return {"QPCR_DATA_DIR": str(data_dir / "data"), "QPCR_UPLOAD_DIR": str(data_dir / "uploads")}


def workbench_running(port: int) -> bool:
    try:
        with _LOCAL.open(f"http://{HOST}:{port}/api/health", timeout=2) as response:
            return json.load(response).get("app") == APP_NAME
    except (OSError, ValueError, AttributeError):
        return False


def bind_local_socket(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if os.name != "nt":
        # As uvicorn does: permit an immediate restart. On Windows this option would allow port sharing.
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((HOST, port))
    except OSError:
        sock.close()
        raise
    return sock


def local_app(interface: Path) -> FastAPI:
    # Imported only after the storage environment is set: the module opens its database on import.
    from backend.app import app

    mount_web_interface(app, interface)
    # Refuses requests addressed to any other host name (DNS rebinding from a web page).
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS)
    return app


def in_wsl() -> bool:
    return sys.platform == "linux" and "microsoft" in platform.uname().release.lower()


def open_browser(url: str) -> None:
    """Open the default browser. Under WSL that is the Windows browser: gio and xdg-open cannot reach it."""
    if in_wsl() and not os.environ.get("BROWSER"):
        for program in ("wslview", "explorer.exe"):
            path = shutil.which(program)
            if not path:
                continue
            try:
                # Detached from the terminal: a Windows program must not read the launcher's input or get its Ctrl+C.
                subprocess.Popen([path, url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
                return
            except OSError:
                continue
    webbrowser.open(url)


def open_browser_when_ready(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        if server.should_exit:
            return
        time.sleep(0.1)
    open_browser(url)


def source_checkout(package_dir: Path = PACKAGE_DIR) -> tuple[Path, list[str]] | None:
    """The checkout this code runs from (an editable install), with the dependencies it declares now."""
    try:
        project = tomllib.loads((package_dir.parent / "pyproject.toml").read_text(encoding="utf-8")).get("project", {})
    except (OSError, tomllib.TOMLDecodeError):
        return None
    return (package_dir.parent, list(project.get("dependencies", []))) if project.get("name") == DISTRIBUTION else None


def missing_packages(package_dir: Path = PACKAGE_DIR) -> list[str]:
    """Declared dependencies that are not installed. An editable install keeps the packages of its first
    install while its code follows the checkout, so a dependency added later is missing until it is reinstalled."""
    checkout = source_checkout(package_dir)
    try:
        requirements = checkout[1] if checkout else metadata.requires(DISTRIBUTION) or []
    except metadata.PackageNotFoundError:
        return []
    # Markers (extras, platforms) cannot be evaluated without the packaging library: skipped, never reported.
    names = [match.group(0) for requirement in requirements
             if ";" not in requirement and (match := _REQUIREMENT_NAME.match(requirement))]

    def installed(name: str) -> bool:
        try:
            metadata.distribution(name)
        except metadata.PackageNotFoundError:
            return False
        return True

    return [name for name in names if not installed(name)]


def update_command(package_dir: Path = PACKAGE_DIR, uv_tool: bool | None = None) -> str | None:
    """The command that installs a checkout's current dependencies into the environment running this code."""
    checkout = source_checkout(package_dir)
    if not checkout:
        return None
    if (Path(sys.prefix) / "uv-receipt.toml").is_file() if uv_tool is None else uv_tool:
        python = f"{sys.version_info.major}.{sys.version_info.minor}"
        return f'uv tool install --python {python} --editable "{checkout[0]}" --reinstall'
    if os.name == "nt":
        # PowerShell runs a quoted program path only after the call operator.
        return f'& "{sys.executable}" -m pip install -e "{checkout[0]}"'
    return shlex.join([sys.executable, "-m", "pip", "install", "-e", str(checkout[0])])


def missing_packages_advice(missing: list[str], package_dir: Path = PACKAGE_DIR, uv_tool: bool | None = None) -> str:
    command = update_command(package_dir, uv_tool)
    update = (f"To update it, stop the workbench (Ctrl+C) if it is running, then run:\n  {command}" if command
              else "Reinstall it from its .whl file, as described in INSTALL.md.")
    return f"This installation is missing {', '.join(missing)}, which the workbench needs. {update}"


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    url = f"http://{HOST}:{args.port}/"
    if workbench_running(args.port):
        print(f"{APP_NAME} is already running at {url}", flush=True)
        if not args.no_browser:
            open_browser(url)
        return
    interface = find_web_interface(PACKAGE_DIR)
    if interface is None:
        raise SystemExit("This installation is missing its web interface. Reinstall it from the "
                         "released .whl file, as described in INSTALL.md.")
    try:
        sock = bind_local_socket(args.port)
    except OSError as error:
        raise SystemExit(f"Port {args.port} is already used by another program ({error}).\n"
                         f"Start on another port instead: qpcr-workbench --port {args.port + 1}") from None
    data_dir = args.data_dir.expanduser().resolve()
    os.environ.update(storage_environment(data_dir))
    missing = missing_packages()
    try:
        app = local_app(interface)
    except ModuleNotFoundError as error:
        sock.close()
        raise SystemExit(f"The workbench cannot start. {missing_packages_advice([error.name or str(error)])}") from None
    server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=args.port, log_level="warning"))
    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(server, url), daemon=True).start()
    print(f"{APP_NAME} {__version__}", flush=True)
    print(f"Open {url} in your browser.", flush=True)
    print(f"Your data: {data_dir}", flush=True)
    print("Keep this window open while you work. Press Ctrl+C to stop.", flush=True)
    if missing:
        print(f"Warning: some files cannot be imported. {missing_packages_advice(missing)}", file=sys.stderr, flush=True)
    try:
        server.run(sockets=[sock])
    except KeyboardInterrupt:
        # uvicorn re-raises the Ctrl+C after its clean shutdown; uvicorn.run() hides it, Server.run() does not.
        pass
    print("The workbench has stopped.", flush=True)


if __name__ == "__main__":
    main()
