from pathlib import Path
from typing import Union


class PrivateScreenshotPathError(ValueError):
    pass


def resolve_private_screenshot_path(
    image_path: Union[str, Path],
    screenshot_directory: Union[str, Path],
) -> Path:
    """Resolve a backend-created PNG without allowing caller-controlled traversal."""
    if not isinstance(image_path, (str, Path)) or not str(image_path).strip():
        raise PrivateScreenshotPathError("Screenshot path is missing")

    requested = Path(image_path)
    if not requested.is_absolute():
        raise PrivateScreenshotPathError("Screenshot path must be absolute")
    if requested.is_symlink():
        raise PrivateScreenshotPathError("Screenshot symlinks are not allowed")

    root = Path(screenshot_directory).resolve()
    try:
        resolved = requested.resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        raise PrivateScreenshotPathError("Screenshot file does not exist") from exc

    if resolved.parent != root:
        raise PrivateScreenshotPathError("Screenshot is outside the private capture directory")
    if resolved.suffix.lower() != ".png" or not resolved.is_file():
        raise PrivateScreenshotPathError("Screenshot must be a regular PNG file")
    return resolved
