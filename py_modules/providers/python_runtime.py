# providers/python_runtime.py
# Find a Python interpreter for subprocess execution.
# Prefers the bundled portable Python (extracted from plugin-dependencies.tar.gz)
# so the plugin works on any Linux distro regardless of system Python version.
# Falls back to a version-checked system Python for dev installs without
# the bundled runtime.

import logging
import os
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# Must match the cpython ABI of the bundled C extensions
# (numpy, Pillow, onnxruntime — all cp313)
REQUIRED_PYTHON = (3, 13)

BUNDLED_PYTHON_RELPATH = os.path.join("bin", "python313", "python", "bin", "python3.13")

_cached_path: Optional[str] = None


def find_python(plugin_dir: str) -> Optional[str]:
    """
    Return path to a Python interpreter compatible with bundled cp313 wheels.

    Resolution order:
        1. Bundled portable Python under <plugin_dir>/bin/python313/
        2. System python3.13 (verified against REQUIRED_PYTHON)
        3. System python3 symlink (verified against REQUIRED_PYTHON)
    """
    global _cached_path
    if _cached_path and os.path.exists(_cached_path):
        return _cached_path

    bundled = os.path.join(plugin_dir, BUNDLED_PYTHON_RELPATH)
    if os.path.exists(bundled) and os.access(bundled, os.X_OK):
        if _is_compatible(bundled):
            logger.debug(f"Using bundled Python: {bundled}")
            _cached_path = bundled
            return bundled
        logger.warning(f"Bundled Python at {bundled} failed version check")

    candidates = [
        "/usr/bin/python3.13",
        "/usr/local/bin/python3.13",
        "/usr/bin/python3",
        "/usr/local/bin/python3",
    ]
    for path in candidates:
        if not (os.path.exists(path) and os.access(path, os.X_OK)):
            continue
        if _is_compatible(path):
            logger.debug(f"Using system Python: {path}")
            _cached_path = path
            return path

    logger.warning(
        f"No compatible Python {REQUIRED_PYTHON[0]}.{REQUIRED_PYTHON[1]} interpreter found"
    )
    return None


def _is_compatible(path: str) -> bool:
    """Verify the interpreter at path matches REQUIRED_PYTHON."""
    try:
        result = subprocess.run(
            [path, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.returncode != 0:
            return False
        major, minor = map(int, result.stdout.strip().split())
        return (major, minor) == REQUIRED_PYTHON
    except Exception as e:
        logger.debug(f"Compatibility check failed for {path}: {e}")
        return False


def reset_cache() -> None:
    """Clear the cached interpreter path. Used by tests / after re-extraction."""
    global _cached_path
    _cached_path = None
