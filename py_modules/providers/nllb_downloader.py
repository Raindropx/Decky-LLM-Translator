# providers/nllb_downloader.py
# Manages NLLB-200 model download, storage, and lifecycle

import logging
import os
import shutil
import threading
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Map plugin language codes to NLLB-200 language codes
NLLB_LANG_MAP = {
    "en": "eng_Latn",
    "ja": "jpn_Jpan",
    "zh-CN": "zho_Hans",
    "zh-TW": "zho_Hant",
    "ko": "kor_Hang",
    "de": "deu_Latn",
    "fr": "fra_Latn",
    "es": "spa_Latn",
    "it": "ita_Latn",
    "pt": "por_Latn",
    "ru": "rus_Cyrl",
    "ar": "arb_Arab",
    "nl": "nld_Latn",
    "no": "nob_Latn",  # Norwegian Bokmål
    "pl": "pol_Latn",
    "tr": "tur_Latn",
    "uk": "ukr_Cyrl",
    "el": "ell_Grek",
    "fi": "fin_Latn",
    "th": "tha_Thai",
    "vi": "vie_Latn",
    "ro": "ron_Latn",
    "bg": "bul_Cyrl",
    "hi": "hin_Deva",
    "id": "ind_Latn",
    "hr": "hrv_Latn",
    "cs": "ces_Latn",
    "hu": "hun_Latn",
    "sv": "swe_Latn",
    "da": "dan_Latn",
}

REQUIRED_MODEL_FILES = ["model.bin", "sentencepiece.bpe.model", "config.json", "shared_vocabulary.txt"]
OPTIONAL_MODEL_FILES = ["tokenizer_config.json", "special_tokens_map.json"]

HF_REPO = "JustFrederik/nllb-200-distilled-1.3B-ct2-int8"
HF_BASE_URL = f"https://huggingface.co/{HF_REPO}/resolve/main/{{filename}}"
MODEL_DIR_NAME = "nllb-200-distilled-1.3B"
MODEL_APPROX_MB = 1410

# Old model dirs cleaned up on startup - safeguard for future
LEGACY_MODEL_DIRS = ["nllb-200-distilled-600M"]


class NLLBDownloader:
    """Manages the single NLLB model download and storage."""

    def __init__(self, models_dir: str):
        self._models_dir = models_dir
        self._downloading = False
        self._download_progress = 0.0
        self._download_error = None
        self._download_cancel = False
        self._download_thread = None
        self._lock = threading.Lock()

        os.makedirs(models_dir, exist_ok=True)
        self._cleanup_partial_downloads()
        self._cleanup_legacy_models()

    def _cleanup_partial_downloads(self):
        """Remove any leftover .downloading directories from interrupted downloads."""
        try:
            for item in os.listdir(self._models_dir):
                if item.endswith(".downloading"):
                    path = os.path.join(self._models_dir, item)
                    if os.path.isdir(path):
                        shutil.rmtree(path, ignore_errors=True)
                        logger.info(f"Cleaned up partial download: {item}")
        except Exception as e:
            logger.error(f"Error cleaning up partial downloads: {e}")

    def _cleanup_legacy_models(self):
        """Delete obsolete model directories left over from older plugin builds."""
        for name in LEGACY_MODEL_DIRS:
            path = os.path.join(self._models_dir, name)
            if os.path.isdir(path):
                try:
                    shutil.rmtree(path)
                    logger.info(f"Removed legacy model directory: {name}")
                except Exception as e:
                    logger.error(f"Could not remove legacy model {name}: {e}")

    def get_model_dir(self) -> str:
        return os.path.join(self._models_dir, MODEL_DIR_NAME)

    def is_model_downloaded(self) -> bool:
        model_dir = self.get_model_dir()
        if not os.path.isdir(model_dir):
            return False
        return all(
            os.path.exists(os.path.join(model_dir, f))
            for f in REQUIRED_MODEL_FILES
        )

    def get_model_size(self) -> int:
        model_dir = self.get_model_dir()
        if not os.path.isdir(model_dir):
            return 0
        total = 0
        for f in os.listdir(model_dir):
            fp = os.path.join(model_dir, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
        return total

    def get_approx_size_mb(self) -> int:
        return MODEL_APPROX_MB

    def get_nllb_lang_code(self, plugin_code: str) -> Optional[str]:
        return NLLB_LANG_MAP.get(plugin_code)

    def start_download(self) -> bool:
        with self._lock:
            if self._downloading:
                return False
            self._downloading = True
            self._download_progress = 0.0
            self._download_error = None
            self._download_cancel = False

        self._download_thread = threading.Thread(
            target=self._download_model, daemon=True
        )
        self._download_thread.start()
        return True

    def _download_model(self):
        """Download model files from HuggingFace. Runs in background thread."""
        import requests

        temp_dir = os.path.join(self._models_dir, f"{MODEL_DIR_NAME}.downloading")
        final_dir = self.get_model_dir()

        try:
            os.makedirs(temp_dir, exist_ok=True)

            all_files = REQUIRED_MODEL_FILES + OPTIONAL_MODEL_FILES

            for filename in all_files:
                if self._download_cancel:
                    raise Exception("Download cancelled")

                url = HF_BASE_URL.format(filename=filename)
                dest = os.path.join(temp_dir, filename)
                is_required = filename in REQUIRED_MODEL_FILES

                try:
                    resp = requests.get(url, stream=True, timeout=30)

                    if resp.status_code == 404:
                        if is_required:
                            raise Exception(f"Required file not found: {filename}")
                        continue
                    elif resp.status_code == 429:
                        raise Exception("Too many requests. Try again later.")
                    elif resp.status_code != 200:
                        if is_required:
                            raise Exception(f"HTTP {resp.status_code} downloading {filename}")
                        continue

                    total_size = int(resp.headers.get('content-length', 0))
                    downloaded = 0

                    with open(dest, 'wb') as f:
                        for chunk in resp.iter_content(chunk_size=1024 * 256):
                            if self._download_cancel:
                                raise Exception("Download cancelled")
                            f.write(chunk)
                            downloaded += len(chunk)

                            if filename == "model.bin" and total_size > 0:
                                with self._lock:
                                    self._download_progress = downloaded / total_size

                except requests.ConnectionError:
                    raise Exception("Cannot reach model server. Check internet connection.")
                except requests.Timeout:
                    raise Exception("Download timed out. Check internet connection.")

            for req_file in REQUIRED_MODEL_FILES:
                if not os.path.exists(os.path.join(temp_dir, req_file)):
                    raise Exception(f"Missing required file after download: {req_file}")

            if os.path.exists(final_dir):
                shutil.rmtree(final_dir)
            os.rename(temp_dir, final_dir)

            with self._lock:
                self._download_progress = 1.0
                self._downloading = False

            logger.info("NLLB model downloaded successfully")

        except Exception as e:
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

            with self._lock:
                self._download_error = str(e)
                self._downloading = False

            logger.error(f"NLLB model download failed: {e}")

    def cancel_download(self):
        with self._lock:
            self._download_cancel = True

    def get_download_status(self) -> Dict:
        with self._lock:
            return {
                "downloading": self._downloading,
                "progress": self._download_progress,
                "error": self._download_error,
            }

    def clear_download_error(self):
        with self._lock:
            self._download_error = None

    def delete_model(self) -> bool:
        model_dir = self.get_model_dir()
        if os.path.isdir(model_dir):
            try:
                shutil.rmtree(model_dir)
                logger.info("Deleted NLLB model")
                return True
            except Exception as e:
                logger.error(f"Error deleting NLLB model: {e}")
                return False
        return True
