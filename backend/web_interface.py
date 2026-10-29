"""Serve the built React interface from the API's own address."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from starlette.responses import Response
from starlette.staticfiles import PathLike, StaticFiles
from starlette.types import Scope


class _InterfaceFiles(StaticFiles):
    # HTML is revalidated on every load so an upgraded installation never pairs a cached
    # page with asset files that were replaced; hashed assets keep normal caching.
    def file_response(self, full_path: PathLike, stat_result: os.stat_result, scope: Scope, status_code: int = 200) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        if str(full_path).endswith(".html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def find_web_interface(package_dir: Path) -> Path | None:
    """Return the build shipped inside an installed wheel, else a source checkout's frontend build."""
    for candidate in (package_dir / "static", package_dir.parent / "frontend" / "dist"):
        if (candidate / "index.html").is_file():
            return candidate
    return None


def mount_web_interface(app: FastAPI, directory: Path) -> None:
    # Mounted last, so every API route registered earlier keeps precedence.
    app.mount("/", _InterfaceFiles(directory=directory, html=True), name="web-interface")
