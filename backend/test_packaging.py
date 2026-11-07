from __future__ import annotations

import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import __main__ as launcher
from backend import __version__
from backend.web_interface import find_web_interface, mount_web_interface

ROOT = Path(__file__).resolve().parent.parent
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
needs_interface = pytest.mark.skipif(
    find_web_interface(ROOT / "backend") is None, reason="build the frontend first (npm run build)"
)


def write_interface(directory: Path) -> Path:
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text('<div id="root"></div>', encoding="utf-8")
    (directory / "assets" / "index-abc123.js").write_text("export {}", encoding="utf-8")
    return directory


def test_built_interface_is_served_beside_the_api(tmp_path: Path) -> None:
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_web_interface(app, write_interface(tmp_path / "dist"))
    client = TestClient(app)
    page = client.get("/")
    assert page.status_code == 200 and 'id="root"' in page.text
    # A page cached across an upgrade would request asset files that no longer exist.
    assert page.headers["cache-control"] == "no-cache"
    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200 and "cache-control" not in asset.headers
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/unknown").status_code == 404


def test_installed_interface_is_preferred_over_a_checkout_build(tmp_path: Path) -> None:
    package = tmp_path / "backend"
    assert find_web_interface(package) is None
    checkout = write_interface(tmp_path / "frontend" / "dist")
    assert find_web_interface(package) == checkout
    installed = write_interface(package / "static")
    assert find_web_interface(package) == installed


def test_other_websites_cannot_read_the_local_api() -> None:
    from backend.app import app

    response = TestClient(app).get("/api/health", headers={"Origin": "https://example.org"})
    assert response.json()["version"] == __version__
    assert "access-control-allow-origin" not in response.headers


def test_launcher_keeps_data_outside_the_installation(tmp_path: Path) -> None:
    args = launcher.parse_args([])
    assert args.port == launcher.DEFAULT_PORT
    assert args.data_dir == Path.home() / ".qpcr-workbench"
    assert launcher.storage_environment(tmp_path) == {
        "QPCR_DATA_DIR": str(tmp_path / "data"),
        "QPCR_UPLOAD_DIR": str(tmp_path / "uploads"),
    }
    with pytest.raises(SystemExit):
        launcher.parse_args(["--port", "70000"])


@pytest.mark.parametrize("guide", ["INSTALL.md", "README.md"])
def test_package_version_has_one_source_and_install_guides_name_its_wheel(guide: str) -> None:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    assert "version" in project["project"]["dynamic"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", __version__)
    # Colleagues paste the install command verbatim, so a stale filename installs nothing.
    text = (ROOT / guide).read_text(encoding="utf-8")
    assert f"qpcr_workbench-{__version__}-py3-none-any.whl" in text
    assert not set(re.findall(r"qpcr_workbench-([\d.]+)-py3", text)) - {__version__}


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def launch(port: int, data_dir: Path) -> list[str]:
    return [sys.executable, "-m", "backend", "--no-browser", "--port", str(port), "--data-dir", str(data_dir)]


def status(url: str, host: str | None = None) -> int:
    request = urllib.request.Request(url, headers={"Host": host} if host else {})
    try:
        with LOCAL.open(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def wait_until_serving(url: str, server: subprocess.Popen, log: Path) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise AssertionError(f"launcher exited early:\n{log.read_text(encoding='utf-8')}")
        try:
            if status(url) == 200:
                return
        except OSError:
            time.sleep(0.2)
    raise AssertionError(f"launcher did not start:\n{log.read_text(encoding='utf-8')}")


@needs_interface
def test_launcher_serves_interface_and_api_from_one_local_address(tmp_path: Path) -> None:
    port, log = free_port(), tmp_path / "server.log"
    with log.open("w", encoding="utf-8") as output:
        server = subprocess.Popen(launch(port, tmp_path / "store"), cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
    try:
        base = f"http://127.0.0.1:{port}"
        wait_until_serving(f"{base}/api/health", server, log)
        with LOCAL.open(f"{base}/", timeout=5) as page:
            assert 'id="root"' in page.read().decode("utf-8")
        assert (tmp_path / "store" / "data" / "qpcr.db").is_file()
        # A web page cannot reach the app by rebinding its own host name to this address.
        assert status(f"{base}/api/health", host="attacker.example") == 400
        again = subprocess.run(launch(port, tmp_path / "store"), cwd=ROOT, capture_output=True, text=True, timeout=60)
        assert again.returncode == 0 and "already running" in again.stdout
    finally:
        server.terminate()
        server.wait(timeout=15)


@needs_interface
@pytest.mark.skipif(sys.platform == "win32", reason="sends a POSIX interrupt signal")
def test_ctrl_c_stops_the_launcher_without_a_traceback(tmp_path: Path) -> None:
    port, log = free_port(), tmp_path / "server.log"
    with log.open("w", encoding="utf-8") as output:
        server = subprocess.Popen(launch(port, tmp_path / "store"), cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
    try:
        wait_until_serving(f"http://127.0.0.1:{port}/api/health", server, log)
        server.send_signal(signal.SIGINT)
        # Ctrl+C is the documented way to stop; a traceback there reads as a crash.
        assert server.wait(timeout=15) == 0
    finally:
        if server.poll() is None:
            server.kill()
    output_text = log.read_text(encoding="utf-8")
    assert "Traceback" not in output_text and "has stopped" in output_text


def test_launcher_explains_a_port_taken_by_another_program(tmp_path: Path) -> None:
    with socket.socket() as other:
        other.bind(("127.0.0.1", 0))
        other.listen()
        port = other.getsockname()[1]
        result = subprocess.run(launch(port, tmp_path), cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 1
    assert f"--port {port + 1}" in result.stderr
    assert not (tmp_path / "data").exists()


URL = "http://127.0.0.1:8002/"


def test_browser_opens_on_the_windows_desktop_under_wsl(monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[list[str]] = []
    opened: list[str] = []
    monkeypatch.delenv("BROWSER", raising=False)
    monkeypatch.setattr(launcher, "in_wsl", lambda: True)
    monkeypatch.setattr(launcher.shutil, "which", lambda program: f"/mnt/c/Windows/{program}" if program == "explorer.exe" else None)
    monkeypatch.setattr(launcher.subprocess, "Popen", lambda command, **options: started.append(command) or options)
    monkeypatch.setattr(launcher.webbrowser, "open", opened.append)
    launcher.open_browser(URL)
    # gio and xdg-open cannot reach the Windows desktop from WSL: "gio: ...: Operation not supported".
    assert started == [["/mnt/c/Windows/explorer.exe", URL]] and opened == []
    # A browser the user chose, and every other system, use Python's own lookup.
    monkeypatch.setenv("BROWSER", "firefox")
    launcher.open_browser(URL)
    monkeypatch.delenv("BROWSER")
    monkeypatch.setattr(launcher, "in_wsl", lambda: False)
    launcher.open_browser(URL)
    assert opened == [URL, URL] and len(started) == 1


def write_checkout(directory: Path, dependencies: list[str], name: str = "qpcr-workbench") -> Path:
    (directory / "backend").mkdir(parents=True)
    listed = ", ".join(f'"{dependency}"' for dependency in dependencies)
    (directory / "pyproject.toml").write_text(f'[project]\nname = "{name}"\ndependencies = [{listed}]\n', encoding="utf-8")
    return directory / "backend"


def test_launcher_names_packages_the_code_needs_but_the_installation_lacks(tmp_path: Path) -> None:
    # An editable installation runs updated code with the packages of its first install: xlrd came later.
    # A marker cannot be evaluated without the packaging library: such an entry is skipped, never reported.
    package = write_checkout(tmp_path / "checkout", ["fastapi>=0.1", "uvicorn[standard]>=0.30,<1", "qpcr-never-installed>=1",
                                                     "qpcr-windows-only>=1; sys_platform == 'win32'"])
    assert launcher.missing_packages(package) == ["qpcr-never-installed"]
    checkout = tmp_path / "checkout"
    python = f"{sys.version_info.major}.{sys.version_info.minor}"
    tool = launcher.missing_packages_advice(["xlrd"], package, uv_tool=True)
    assert "xlrd" in tool and f'uv tool install --python {python} --editable "{checkout}" --reinstall' in tool
    pip = launcher.missing_packages_advice(["xlrd"], package, uv_tool=False)
    assert (f'& "{sys.executable}"' if os.name == "nt" else shlex.join([sys.executable, "-m", "pip", "install", "-e", str(checkout)])) in pip
    # Another project's pyproject.toml beside an installed package says nothing about this installation.
    other = write_checkout(tmp_path / "other", ["qpcr-never-installed"], name="something-else")
    assert "qpcr-never-installed" not in launcher.missing_packages(other)
    assert "INSTALL.md" in launcher.missing_packages_advice(["xlrd"], other, uv_tool=True)


def test_launcher_explains_a_missing_package_instead_of_a_traceback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def without_scipy(_interface: Path) -> FastAPI:
        raise ModuleNotFoundError("No module named 'scipy'", name="scipy")

    monkeypatch.setattr(launcher, "local_app", without_scipy)
    monkeypatch.setattr(launcher, "find_web_interface", lambda _: write_interface(tmp_path / "dist"))
    # main() points the storage variables at --data-dir; monkeypatch restores this process's values afterwards.
    for key in ("QPCR_DATA_DIR", "QPCR_UPLOAD_DIR"):
        monkeypatch.setenv(key, str(tmp_path / "unused"))
    with pytest.raises(SystemExit) as stopped:
        launcher.main(["--no-browser", "--port", str(free_port()), "--data-dir", str(tmp_path / "store")])
    message = str(stopped.value.code)
    assert message.startswith("The workbench cannot start") and "scipy" in message
