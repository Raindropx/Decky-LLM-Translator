# Fetches RapidOCR ONNX models + dicts from upstream sources.
# Threaded downloader with a UI-friendly progress shape.

import logging
import os
import shutil
import threading
from typing import Dict, Optional, Tuple

from .download_verification import download_verified_response

logger = logging.getLogger(__name__)

# Upstream sources mirror the CI workflow at .github/workflows/build.yml
PADDLEOCR_RELEASES = (
    "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0"
)
MONKT_REVISION = "7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65"
SWHL_REVISION = "1cfba2e90fc938db55889873735088de210cc173"
MONKT_BASE = (
    f"https://huggingface.co/monkt/paddleocr-onnx/resolve/{MONKT_REVISION}/languages"
)
SWHL_CLS_URL = (
    f"https://huggingface.co/SWHL/RapidOCR/resolve/{SWHL_REVISION}/PP-OCRv3/"
    "ch_ppocr_mobile_v2.0_cls_train.onnx"
)

RAPIDOCR_DIR_NAME = "rapidocr"
APPROX_SIZE_MB = 75

# Manifest of (url, dest_filename, exact_bytes, sha256). Exact sizes weight
# progress and stop unexpectedly large responses before they fill storage.
MANIFEST: Tuple[Tuple[str, str, int, str], ...] = (
    (f"{PADDLEOCR_RELEASES}/PP-OCRv5_mobile_det.onnx",
     "ch_PP-OCRv5_mobile_det.onnx", 4_748_769,
     "ca3014670099126189c9519ef770470c03bf41695fb138c6bc19737bd4ba2875"),
    (f"{PADDLEOCR_RELEASES}/PP-OCRv5_mobile_rec.onnx",
     "ch_rec.onnx", 16_517_247,
     "64ea1b54ea0506609378a3638ff5b2547af7e24809b890e501fb0cce54de21f7"),
    (f"{MONKT_BASE}/chinese/dict.txt",
     "ch_dict.txt", 74_012,
     "d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b"),
    (SWHL_CLS_URL,
     "ch_ppocr_mobile_v2.0_cls_infer.onnx", 581_639,
     "70581b300b83babd9e0dd1d7d74c5b006869e8796da277a70c2e405bf9d77c82"),
    (f"{MONKT_BASE}/english/rec.onnx", "english_rec.onnx", 7_830_888,
     "4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7"),
    (f"{MONKT_BASE}/english/dict.txt", "english_dict.txt", 1_416,
     "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6"),
    (f"{MONKT_BASE}/latin/rec.onnx", "latin_rec.onnx", 7_862_832,
     "614ffc2d6d3902d360fad7f1b0dd455ee45e877069d14c4e51a99dc4ef144409"),
    (f"{MONKT_BASE}/latin/dict.txt", "latin_dict.txt", 1_634,
     "3c0a8a79b612653c25f765271714f71281e4e955962c153e272b7b8c1d2b13ff"),
    (f"{MONKT_BASE}/eslav/rec.onnx", "eslav_rec.onnx", 7_870_092,
     "dc6bf0e855247decce214ba6dae5bc135fa0ad725a5918a7fcfb59fad6c9cdee"),
    (f"{MONKT_BASE}/eslav/dict.txt", "eslav_dict.txt", 1_663,
     "3e95f1581557162870cacdba5af91a4c6be2890710d395b0c3c7578e7ee5e6eb"),
    (f"{MONKT_BASE}/korean/rec.onnx", "korean_rec.onnx", 13_401_252,
     "322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa"),
    (f"{MONKT_BASE}/korean/dict.txt", "korean_dict.txt", 47_451,
     "a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7"),
    (f"{MONKT_BASE}/greek/rec.onnx", "greek_rec.onnx", 7_791_200,
     "13373f736dbb229e96945fc41c2573403d91503b0775c7b7294839e0c5f3a7a3"),
    (f"{MONKT_BASE}/greek/dict.txt", "greek_dict.txt", 1_103,
     "31defc62c0c3ad3674a82da6192226a2ba98ef4ff014a7045cb88d59f9c3de31"),
    (f"{MONKT_BASE}/thai/rec.onnx", "thai_rec.onnx", 7_873_480,
     "2b6e56b1872200349e227574c25aeb0e0f9af9b8356e9ff5f75ac543a535669a"),
    (f"{MONKT_BASE}/thai/dict.txt", "thai_dict.txt", 1_767,
     "57f5406f94bb6688fb7077f7be65f08bbd71cecf48c01ea26c522cb5c4836b7a"),
)

# Every entry in MANIFEST must end up on disk for the install to be valid.
REQUIRED_FILES: Tuple[str, ...] = tuple(name for _, name, _, _ in MANIFEST)

TOTAL_EXPECTED_BYTES = sum(size for _, _, size, _ in MANIFEST)
MAX_MODEL_FILE_BYTES = 24 * 1024 * 1024


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

            for url, filename, expected_size, expected_sha256 in MANIFEST:
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

                def update_progress(file_downloaded: int):
                    with self._lock:
                        # Cap at 0.99 so the bar isn't pinned during the
                        # final required-files check + atomic rename.
                        self._download_progress = min(
                            0.99,
                            (downloaded_global + file_downloaded)
                            / TOTAL_EXPECTED_BYTES,
                        )

                try:
                    downloaded = download_verified_response(
                        resp,
                        dest,
                        expected_sha256=expected_sha256,
                        expected_size=expected_size,
                        max_bytes=MAX_MODEL_FILE_BYTES,
                        should_cancel=lambda: self._download_cancel,
                        on_progress=update_progress,
                    )
                finally:
                    resp.close()
                downloaded_global += downloaded

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
