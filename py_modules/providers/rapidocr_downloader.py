# Fetches RapidOCR ONNX models + dicts from upstream sources.
# Threaded downloader with a UI-friendly progress shape.

import logging
import os
import shutil
import threading
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Upstream sources mirror the CI workflow at .github/workflows/build.yml
PADDLEOCR_RELEASES = (
    "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0"
)
MONKT_BASE = "https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages"
SWHL_CLS_URL = (
    "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/"
    "ch_ppocr_mobile_v2.0_cls_train.onnx"
)

RAPIDOCR_DIR_NAME = "rapidocr"
APPROX_SIZE_MB = 75

# Manifest of (url, dest_filename, approx_bytes). approx_bytes
# weights global progress so the bar moves steadily across files.
MANIFEST: Tuple[Tuple[str, str, int], ...] = (
    (f"{PADDLEOCR_RELEASES}/PP-OCRv5_mobile_det.onnx",
     "ch_PP-OCRv5_mobile_det.onnx", 4_748_769),
    (f"{PADDLEOCR_RELEASES}/PP-OCRv5_mobile_rec.onnx",
     "ch_rec.onnx", 16_517_247),
    (f"{MONKT_BASE}/chinese/dict.txt",
     "ch_dict.txt", 74_012),
    (SWHL_CLS_URL,
     "ch_ppocr_mobile_v2.0_cls_infer.onnx", 581_639),
    (f"{MONKT_BASE}/english/rec.onnx", "english_rec.onnx", 7_830_888),
    (f"{MONKT_BASE}/english/dict.txt", "english_dict.txt", 1_416),
    (f"{MONKT_BASE}/latin/rec.onnx", "latin_rec.onnx", 7_862_832),
    (f"{MONKT_BASE}/latin/dict.txt", "latin_dict.txt", 1_634),
    (f"{MONKT_BASE}/eslav/rec.onnx", "eslav_rec.onnx", 7_870_092),
    (f"{MONKT_BASE}/eslav/dict.txt", "eslav_dict.txt", 1_663),
    (f"{MONKT_BASE}/korean/rec.onnx", "korean_rec.onnx", 13_401_252),
    (f"{MONKT_BASE}/korean/dict.txt", "korean_dict.txt", 47_451),
    (f"{MONKT_BASE}/greek/rec.onnx", "greek_rec.onnx", 7_791_200),
    (f"{MONKT_BASE}/greek/dict.txt", "greek_dict.txt", 1_103),
    (f"{MONKT_BASE}/thai/rec.onnx", "thai_rec.onnx", 7_873_480),
    (f"{MONKT_BASE}/thai/dict.txt", "thai_dict.txt", 1_767),
)

# Every entry in MANIFEST must end up on disk for the install to be valid.
REQUIRED_FILES: Tuple[str, ...] = tuple(name for _, name, _ in MANIFEST)

TOTAL_EXPECTED_BYTES = sum(approx for _, _, approx in MANIFEST)


class RapidOCRDownloader:
    """Manages RapidOCR ONNX model + dict downloads."""

    def __init__(self, base_dir: str):
        self._base_dir = base_dir
        self._target_dir = os.path.join(base_dir, RAPIDOCR_DIR_NAME)

        self._downloading = False
        self._download_progress = 0.0
        self._download_error: Optional[str] = None
        self._download_cancel = False
        self._download_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

        os.makedirs(base_dir, exist_ok=True)
        self._cleanup_partial()

    def _cleanup_partial(self):
        try:
            for item in os.listdir(self._base_dir):
                if item.endswith(".downloading"):
                    p = os.path.join(self._base_dir, item)
                    if os.path.isdir(p):
                        shutil.rmtree(p, ignore_errors=True)
        except Exception as e:
            logger.error(f"RapidOCRDownloader: cleanup error: {e}")

    def get_target_dir(self) -> str:
        return self._target_dir

    def is_installed(self) -> bool:
        if not os.path.isdir(self._target_dir):
            return False
        return all(
            os.path.exists(os.path.join(self._target_dir, f))
            for f in REQUIRED_FILES
        )

    def get_install_size(self) -> int:
        if not os.path.isdir(self._target_dir):
            return 0
        total = 0
        for f in os.listdir(self._target_dir):
            fp = os.path.join(self._target_dir, f)
            if os.path.isfile(fp):
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
        return total

    def get_approx_size_mb(self) -> int:
        return APPROX_SIZE_MB

    def get_status(self) -> Dict:
        with self._lock:
            return {
                "downloaded": self.is_installed(),
                "size": self.get_install_size(),
                "approx_size_mb": APPROX_SIZE_MB,
                "downloading": self._downloading,
                "progress": self._download_progress,
                "error": self._download_error,
            }

    def start_download(self) -> bool:
        with self._lock:
            if self._downloading:
                return False
            self._downloading = True
            self._download_progress = 0.0
            self._download_error = None
            self._download_cancel = False

        self._download_thread = threading.Thread(
            target=self._download, daemon=True
        )
        self._download_thread.start()
        return True

    def cancel_download(self):
        with self._lock:
            self._download_cancel = True

    def clear_error(self):
        with self._lock:
            self._download_error = None

    def delete(self) -> bool:
        if os.path.isdir(self._target_dir):
            try:
                shutil.rmtree(self._target_dir)
                logger.info("RapidOCRDownloader: deleted RapidOCR models")
                return True
            except Exception as e:
                logger.error(f"RapidOCRDownloader: delete failed: {e}")
                return False
        return True

    def _download(self):
        import requests

        staging_dir = os.path.join(
            self._base_dir, f"{RAPIDOCR_DIR_NAME}.downloading"
        )

        try:
            if os.path.exists(staging_dir):
                shutil.rmtree(staging_dir, ignore_errors=True)
            os.makedirs(staging_dir, exist_ok=True)

            downloaded_global = 0

            for url, filename, _approx in MANIFEST:
                if self._download_cancel:
                    raise Exception("Download cancelled")

                dest = os.path.join(staging_dir, filename)

                try:
                    resp = requests.get(url, stream=True, timeout=30)
                except requests.ConnectionError:
                    raise Exception(
                        "Cannot reach model server. Check internet connection."
                    )
                except requests.Timeout:
                    raise Exception(
                        "Download timed out. Check internet connection."
                    )

                if resp.status_code == 404:
                    raise Exception(f"Required file not found: {filename}")
                if resp.status_code == 429:
                    raise Exception("Too many requests. Try again later.")
                if resp.status_code != 200:
                    raise Exception(
                        f"HTTP {resp.status_code} downloading {filename}"
                    )

                with open(dest, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=1024 * 256):
                        if self._download_cancel:
                            raise Exception("Download cancelled")
                        if not chunk:
                            continue
                        f.write(chunk)
                        downloaded_global += len(chunk)
                        with self._lock:
                            # Cap at 0.99 so the bar isn't pinned during the
                            # final required-files check + atomic rename.
                            self._download_progress = min(
                                0.99, downloaded_global / TOTAL_EXPECTED_BYTES
                            )

            for req in REQUIRED_FILES:
                if not os.path.exists(os.path.join(staging_dir, req)):
                    raise Exception(
                        f"Missing required file after download: {req}"
                    )

            if os.path.exists(self._target_dir):
                shutil.rmtree(self._target_dir)
            os.rename(staging_dir, self._target_dir)

            with self._lock:
                self._download_progress = 1.0
                self._downloading = False

            logger.info("RapidOCR models downloaded successfully")

        except Exception as e:
            if os.path.isdir(staging_dir):
                shutil.rmtree(staging_dir, ignore_errors=True)

            with self._lock:
                self._download_error = str(e)
                self._downloading = False

            logger.error(f"RapidOCR download failed: {e}")
