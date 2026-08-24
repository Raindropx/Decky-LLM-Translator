import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "py_modules"
    / "providers"
    / "download_verification.py"
)
spec = importlib.util.spec_from_file_location("download_verification", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

DownloadVerificationError = module.DownloadVerificationError
download_verified_response = module.download_verified_response


class FakeResponse:
    def __init__(self, chunks, content_length=None):
        self._chunks = chunks
        self.headers = {}
        if content_length is not None:
            self.headers["content-length"] = str(content_length)

    def iter_content(self, chunk_size):
        del chunk_size
        yield from self._chunks


class DownloadVerificationTests(unittest.TestCase):
    def test_writes_only_expected_content(self):
        content = b"verified model bytes"
        response = FakeResponse([content[:5], b"", content[5:]], len(content))
        progress = []
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "model.bin"
            downloaded = download_verified_response(
                response,
                str(destination),
                expected_sha256=hashlib.sha256(content).hexdigest(),
                expected_size=len(content),
                max_bytes=1024,
                on_progress=progress.append,
            )
            self.assertEqual(downloaded, len(content))
            self.assertEqual(destination.read_bytes(), content)
            self.assertEqual(progress[-1], len(content))

    def test_rejects_wrong_content_length_before_writing(self):
        response = FakeResponse([b"abc"], content_length=4)
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "model.bin"
            with self.assertRaisesRegex(DownloadVerificationError, "Unexpected download size"):
                download_verified_response(
                    response,
                    str(destination),
                    expected_sha256=hashlib.sha256(b"abc").hexdigest(),
                    expected_size=3,
                    max_bytes=10,
                )
            self.assertFalse(destination.exists())

    def test_rejects_checksum_mismatch(self):
        response = FakeResponse([b"tampered"], content_length=8)
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "model.bin"
            with self.assertRaisesRegex(DownloadVerificationError, "checksum mismatch"):
                download_verified_response(
                    response,
                    str(destination),
                    expected_sha256=hashlib.sha256(b"expected").hexdigest(),
                    expected_size=8,
                    max_bytes=10,
                )
            self.assertFalse(destination.exists())

    def test_rejects_stream_that_exceeds_expected_size(self):
        response = FakeResponse([b"abc", b"d"])
        with tempfile.TemporaryDirectory() as temp_dir:
            destination = Path(temp_dir) / "model.bin"
            with self.assertRaisesRegex(DownloadVerificationError, "exceeds"):
                download_verified_response(
                    response,
                    str(destination),
                    expected_sha256=hashlib.sha256(b"abc").hexdigest(),
                    expected_size=3,
                    max_bytes=10,
                )
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
