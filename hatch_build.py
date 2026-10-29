"""Compile the React interface and ship it inside the wheel as backend/static."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        # Editable development installs run the interface through Vite instead.
        if self.target_name != "wheel" or version == "editable":
            return
        frontend = Path(self.root) / "frontend"
        npm = shutil.which("npm")
        if npm is None:
            raise RuntimeError(
                "Building qpcr-workbench compiles its web interface and needs Node.js (npm). "
                "To install the app without Node.js, use the released .whl file described in INSTALL.md."
            )
        if not (frontend / "node_modules").is_dir():
            subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=frontend, check=True)
        # An empty API root keeps requests on the page's own address, whatever a local .env says.
        subprocess.run([npm, "run", "build"], cwd=frontend, check=True, env={**os.environ, "VITE_API_ROOT": ""})
        build_data.setdefault("force_include", {})[str(frontend / "dist")] = "backend/static"
