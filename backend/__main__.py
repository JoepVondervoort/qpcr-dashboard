"""Start the qPCR Analysis Workbench on this computer and open it in the browser."""

from __future__ import annotations

import argparse
import json
import os
import socket
import threading
import time
import urllib.request
import webbrowser
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


def open_browser_when_ready(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        if server.should_exit:
            return
        time.sleep(0.1)
    webbrowser.open(url)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    url = f"http://{HOST}:{args.port}/"
    if workbench_running(args.port):
        print(f"{APP_NAME} is already running at {url}", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
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
    server = uvicorn.Server(uvicorn.Config(local_app(interface), host=HOST, port=args.port, log_level="warning"))
    if not args.no_browser:
        threading.Thread(target=open_browser_when_ready, args=(server, url), daemon=True).start()
    print(f"{APP_NAME} {__version__}", flush=True)
    print(f"Open {url} in your browser.", flush=True)
    print(f"Your data: {data_dir}", flush=True)
    print("Keep this window open while you work. Press Ctrl+C to stop.", flush=True)
    try:
        server.run(sockets=[sock])
    except KeyboardInterrupt:
        # uvicorn re-raises the Ctrl+C after its clean shutdown; uvicorn.run() hides it, Server.run() does not.
        pass
    print("The workbench has stopped.", flush=True)


if __name__ == "__main__":
    main()
