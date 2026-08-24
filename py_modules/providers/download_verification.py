import hashlib
import os
from typing import Callable, Mapping, Optional


class DownloadVerificationError(Exception):
    pass


def _content_length(headers: Mapping[str, str]) -> Optional[int]:
    raw_value = headers.get("content-length")
    if raw_value in (None, ""):
        return None
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise DownloadVerificationError("Invalid Content-Length from model server") from exc
    if value < 0:
        raise DownloadVerificationError("Invalid Content-Length from model server")
    return value


def download_verified_response(
    response,
    destination: str,
    *,
    expected_sha256: str,
    expected_size: int,
    max_bytes: int,
    should_cancel: Optional[Callable[[], bool]] = None,
    on_progress: Optional[Callable[[int], None]] = None,
    chunk_size: int = 256 * 1024,
) -> int:
    """Stream a response to disk while enforcing size and SHA-256."""
    if expected_size <= 0 or max_bytes < expected_size:
        raise ValueError("Invalid verified-download size limits")
    if len(expected_sha256) != 64:
        raise ValueError("Invalid expected SHA-256")

    content_length = _content_length(response.headers)
    if content_length is not None:
        if content_length > max_bytes:
            raise DownloadVerificationError("Download exceeds the maximum allowed size")
        if content_length != expected_size:
            raise DownloadVerificationError(
                f"Unexpected download size: {content_length} bytes"
            )

    downloaded = 0
    digest = hashlib.sha256()
    try:
        with open(destination, "wb") as output:
            for chunk in response.iter_content(chunk_size=chunk_size):
                if should_cancel and should_cancel():
                    raise DownloadVerificationError("Download cancelled")
                if not chunk:
                    continue
                downloaded += len(chunk)
                if downloaded > max_bytes or downloaded > expected_size:
                    raise DownloadVerificationError("Download exceeds the expected size")
                output.write(chunk)
                digest.update(chunk)
                if on_progress:
                    on_progress(downloaded)

        if should_cancel and should_cancel():
            raise DownloadVerificationError("Download cancelled")
        if downloaded != expected_size:
            raise DownloadVerificationError(
                f"Unexpected download size: {downloaded} bytes"
            )
        actual_sha256 = digest.hexdigest()
        if actual_sha256 != expected_sha256.lower():
            raise DownloadVerificationError("Download checksum mismatch")
        return downloaded
    except Exception:
        try:
            os.remove(destination)
        except OSError:
            pass
        raise
