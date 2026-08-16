"""Safe discovery and replacement helpers for Steam screenshots."""

from __future__ import annotations

import io
import json
import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable


SUPPORTED_SCREENSHOT_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
FFMPEG_PATH = Path("/usr/bin/ffmpeg")
FFPROBE_PATH = Path("/usr/bin/ffprobe")


def normalize_app_id(app_id) -> str:
    """Keep Steam shortcut IDs lossless; some non-Steam IDs exceed JS's safe integer range."""
    value = str(app_id).strip()
    if not value.isdigit() or len(value) > 20:
        raise ValueError("Invalid Steam app ID")
    return value


def steam_userdata_roots(home: str | os.PathLike[str]) -> list[Path]:
    supplied_home = Path(home)
    home_paths = [supplied_home]
    # Decky may expose DECKY_HOME as /home/deck/homebrew even though Steam's
    # userdata belongs under the Unix account home (/home/deck). Keep the
    # caller-provided path first, then add tightly-scoped account-home fallbacks.
    if supplied_home.name == "homebrew":
        home_paths.append(supplied_home.parent)
    home_paths.append(Path.home())
    deck_user_home = Path("/home/deck")
    if deck_user_home.is_dir():
        home_paths.append(deck_user_home)

    candidates: list[Path] = []
    for home_path in home_paths:
        candidates.extend([
            home_path / ".local" / "share" / "Steam" / "userdata",
            home_path / ".steam" / "steam" / "userdata",
        ])
    roots: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
        except OSError:
            resolved = candidate.absolute()
        if resolved in seen:
            continue
        seen.add(resolved)
        roots.append(resolved)
    return roots


def screenshot_directories(home: str | os.PathLike[str], app_id) -> list[Path]:
    normalized_app_id = normalize_app_id(app_id)
    directories: list[Path] = []
    for root in steam_userdata_roots(home):
        if not root.is_dir():
            continue
        for user_dir in root.iterdir():
            if not user_dir.is_dir() or not user_dir.name.isdigit():
                continue
            directory = user_dir / "760" / "remote" / normalized_app_id / "screenshots"
            if directory.is_dir():
                directories.append(directory.resolve())
    return directories


def iter_screenshot_files(home: str | os.PathLike[str], app_id) -> Iterable[Path]:
    for directory in screenshot_directories(home, app_id):
        for path in directory.iterdir():
            if path.is_file() and path.suffix.lower() in SUPPORTED_SCREENSHOT_SUFFIXES:
                yield path


def iter_all_screenshot_files(home: str | os.PathLike[str]) -> Iterable[Path]:
    for root in steam_userdata_roots(home):
        if not root.is_dir():
            continue
        for user_dir in root.iterdir():
            remote_dir = user_dir / "760" / "remote"
            if not user_dir.is_dir() or not remote_dir.is_dir():
                continue
            for app_dir in remote_dir.iterdir():
                screenshot_dir = app_dir / "screenshots"
                if not app_dir.name.isdigit() or not screenshot_dir.is_dir():
                    continue
                for path in screenshot_dir.iterdir():
                    if path.is_file() and path.suffix.lower() in SUPPORTED_SCREENSHOT_SUFFIXES:
                        yield path


def find_latest_screenshot(
    home: str | os.PathLike[str],
    app_id,
    not_before: float,
    excluded_paths: Iterable[str | os.PathLike[str]] = (),
) -> Path | None:
    excluded = {str(Path(path).resolve()) for path in excluded_paths}
    candidates: list[tuple[int, Path]] = []
    for path in iter_screenshot_files(home, app_id):
        if str(path.resolve()) in excluded:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size < 1_000 or stat.st_mtime < not_before:
            continue
        candidates.append((stat.st_mtime_ns, path))
    return max(candidates, default=(0, None), key=lambda item: item[0])[1]


def find_latest_screenshot_any_app(
    home: str | os.PathLike[str],
    not_before: float,
    excluded_paths: Iterable[str | os.PathLike[str]] = (),
) -> Path | None:
    excluded = {str(Path(path).resolve()) for path in excluded_paths}
    candidates: list[tuple[int, Path]] = []
    for path in iter_all_screenshot_files(home):
        if str(path.resolve()) in excluded:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size < 1_000 or stat.st_mtime < not_before:
            continue
        candidates.append((stat.st_mtime_ns, path))
    return max(candidates, default=(0, None), key=lambda item: item[0])[1]


def mime_for_path(path: str | os.PathLike[str]) -> str:
    suffix = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")


def validate_screenshot_path(
    home: str | os.PathLike[str],
    app_id,
    screenshot_path: str | os.PathLike[str],
) -> Path:
    normalized_app_id = normalize_app_id(app_id)
    path = Path(screenshot_path).resolve(strict=True)
    if path.suffix.lower() not in SUPPORTED_SCREENSHOT_SUFFIXES:
        raise ValueError("Unsupported Steam screenshot format")

    for directory in screenshot_directories(home, normalized_app_id):
        if path.parent == directory:
            return path
    raise ValueError("Screenshot path is outside the expected Steam app directory")


def _atomic_write(path: Path, data: bytes) -> None:
    original_mode = stat.S_IMODE(path.stat().st_mode)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".decky-llm-translator-",
            suffix=path.suffix,
            dir=path.parent,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(data)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_path, original_mode)
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except OSError:
                pass


def _atomic_create(path: Path, data: bytes, mode: int = 0o644) -> None:
    """Create a new file atomically and refuse to overwrite an existing path."""
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".decky-llm-translator-",
            suffix=path.suffix,
            dir=path.parent,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            temp_file.write(data)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.chmod(temp_path, mode)
        os.link(temp_path, path)
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except OSError:
                pass


def _probe_image_with_ffprobe(image_bytes: bytes) -> tuple[tuple[int, int], str]:
    result = subprocess.run(
        [
            str(FFPROBE_PATH),
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height",
            "-of", "json",
            "pipe:0",
        ],
        input=image_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=15,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError("Could not decode screenshot image")
    try:
        stream = json.loads(result.stdout.decode("utf-8"))["streams"][0]
        width = int(stream["width"])
        height = int(stream["height"])
        codec = str(stream["codec_name"]).lower()
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Could not inspect screenshot image") from error
    formats = {"mjpeg": "JPEG", "png": "PNG", "webp": "WEBP"}
    image_format = formats.get(codec)
    if width <= 0 or height <= 0 or image_format is None:
        raise ValueError("Unsupported screenshot image encoding")
    return (width, height), image_format


def _probe_image(image_bytes: bytes) -> tuple[tuple[int, int], str]:
    # Pillow's native extension can fail inside Decky's plugin process even
    # when the bundled wheel imports from a normal shell. SteamOS ships these
    # tools, so prefer the isolated decoder there and retain Pillow elsewhere.
    if FFMPEG_PATH.is_file() and FFPROBE_PATH.is_file():
        return _probe_image_with_ffprobe(image_bytes)

    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as image:
        image.load()
        image_format = (image.format or "").upper()
        return image.size, image_format


def _validate_replacement(path: Path, image_bytes: bytes) -> tuple[int, int]:
    original_size, _ = _probe_image(path.read_bytes())
    replacement_size, replacement_format = _probe_image(image_bytes)

    if replacement_size != original_size:
        raise ValueError(
            f"Replacement dimensions {replacement_size} do not match {original_size}"
        )

    expected_formats = {
        ".jpg": {"JPEG"},
        ".jpeg": {"JPEG"},
        ".png": {"PNG"},
        ".webp": {"WEBP"},
    }[path.suffix.lower()]
    if replacement_format not in expected_formats:
        raise ValueError("Replacement image encoding does not match the screenshot suffix")
    return original_size


def _build_thumbnail(path: Path, image_bytes: bytes) -> bytes:
    if FFMPEG_PATH.is_file() and FFPROBE_PATH.is_file():
        suffix = path.suffix.lower()
        codec_args = {
            ".jpg": ["-vcodec", "mjpeg", "-q:v", "3"],
            ".jpeg": ["-vcodec", "mjpeg", "-q:v", "3"],
            ".png": ["-vcodec", "png"],
            ".webp": ["-vcodec", "libwebp", "-quality", "88"],
        }[suffix]
        result = subprocess.run(
            [
                str(FFMPEG_PATH),
                "-nostdin",
                "-v", "error",
                "-i", "pipe:0",
                "-vf", "scale=200:125:force_original_aspect_ratio=decrease",
                "-frames:v", "1",
                "-f", "image2pipe",
                *codec_args,
                "pipe:1",
            ],
            input=image_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
            check=False,
        )
        if result.returncode != 0 or not result.stdout:
            raise ValueError("Could not build Steam screenshot thumbnail")
        thumbnail_size, thumbnail_format = _probe_image_with_ffprobe(result.stdout)
        expected_format = "JPEG" if suffix in {".jpg", ".jpeg"} else suffix[1:].upper()
        if thumbnail_size[0] > 200 or thumbnail_size[1] > 125:
            raise ValueError("Generated screenshot thumbnail is too large")
        if thumbnail_format != expected_format:
            raise ValueError("Generated thumbnail encoding does not match its suffix")
        return result.stdout

    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as thumbnail:
        thumbnail.load()
        thumbnail.thumbnail((200, 125), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        if path.suffix.lower() in {".jpg", ".jpeg"}:
            thumbnail.convert("RGB").save(output, format="JPEG", quality=88)
        elif path.suffix.lower() == ".png":
            thumbnail.save(output, format="PNG", optimize=True)
        else:
            thumbnail.save(output, format="WEBP", quality=88)
    return output.getvalue()


def _translated_copy_candidates(path: Path) -> Iterable[Path]:
    match = re.fullmatch(r"(.+)_([0-9]+)", path.stem)
    if match:
        prefix, current_number = match.groups()
        next_number = int(current_number) + 1
        for number in range(next_number, next_number + 10_000):
            yield path.with_name(f"{prefix}_{number}{path.suffix}")
    else:
        yield path.with_name(f"{path.stem}_translated{path.suffix}")
        for number in range(2, 10_001):
            yield path.with_name(f"{path.stem}_translated_{number}{path.suffix}")


def replace_screenshot_and_thumbnail(
    home: str | os.PathLike[str],
    app_id,
    screenshot_path: str | os.PathLike[str],
    image_bytes: bytes,
) -> dict:
    """Atomically replace a native screenshot and refresh its Steam thumbnail."""
    path = validate_screenshot_path(home, app_id, screenshot_path)
    original_size = _validate_replacement(path, image_bytes)

    _atomic_write(path, image_bytes)

    thumbnail_updated = False
    thumbnail_path = path.parent / "thumbnails" / path.name
    if thumbnail_path.is_file():
        try:
            _atomic_write(thumbnail_path, _build_thumbnail(path, image_bytes))
            thumbnail_updated = True
        except Exception:
            # The full-size screenshot is the source of truth. A stale thumbnail
            # is recoverable and should not roll back a valid annotated image.
            thumbnail_updated = False

    return {
        "path": str(path),
        "width": original_size[0],
        "height": original_size[1],
        "thumbnail_updated": thumbnail_updated,
        "mode": "replace",
    }


def create_translated_screenshot_copy(
    home: str | os.PathLike[str],
    app_id,
    screenshot_path: str | os.PathLike[str],
    image_bytes: bytes,
) -> dict:
    """Preserve Steam's native image and create a numbered translated copy."""
    path = validate_screenshot_path(home, app_id, screenshot_path)
    original_size = _validate_replacement(path, image_bytes)
    thumbnail_bytes = _build_thumbnail(path, image_bytes)
    original_mode = stat.S_IMODE(path.stat().st_mode)

    copy_path: Path | None = None
    for candidate in _translated_copy_candidates(path):
        try:
            _atomic_create(candidate, image_bytes, original_mode)
            copy_path = candidate
            break
        except FileExistsError:
            continue
    if copy_path is None:
        raise FileExistsError("Could not allocate a translated screenshot copy name")

    thumbnail_dir = path.parent / "thumbnails"
    thumbnail_dir.mkdir(mode=0o755, exist_ok=True)
    thumbnail_path = thumbnail_dir / copy_path.name
    try:
        _atomic_create(thumbnail_path, thumbnail_bytes, 0o644)
    except Exception:
        try:
            copy_path.unlink()
        except OSError:
            pass
        raise

    return {
        "path": str(copy_path),
        "original_path": str(path),
        "width": original_size[0],
        "height": original_size[1],
        "thumbnail_updated": True,
        "mode": "copy",
    }
