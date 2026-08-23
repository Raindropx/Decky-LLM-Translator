import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "py_modules" / "providers" / "screenshot_paths.py"
spec = importlib.util.spec_from_file_location("screenshot_paths", MODULE_PATH)
screenshot_paths = importlib.util.module_from_spec(spec)
spec.loader.exec_module(screenshot_paths)
PrivateScreenshotPathError = screenshot_paths.PrivateScreenshotPathError
resolve_private_screenshot_path = screenshot_paths.resolve_private_screenshot_path


class PrivateScreenshotPathTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name) / "private"
        self.root.mkdir()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_accepts_direct_private_png(self):
        screenshot = self.root / "capture.png"
        screenshot.write_bytes(b"png")
        self.assertEqual(resolve_private_screenshot_path(screenshot, self.root), screenshot)

    def test_rejects_file_outside_private_directory(self):
        outside = Path(self.temp_dir.name) / "settings.json"
        outside.write_text("secret", encoding="utf-8")
        with self.assertRaises(PrivateScreenshotPathError):
            resolve_private_screenshot_path(outside, self.root)
        self.assertTrue(outside.exists())

    def test_rejects_nested_and_non_png_files(self):
        nested = self.root / "nested"
        nested.mkdir()
        nested_png = nested / "capture.png"
        nested_png.write_bytes(b"png")
        text_file = self.root / "capture.txt"
        text_file.write_text("not an image", encoding="utf-8")
        for candidate in (nested_png, text_file):
            with self.subTest(candidate=candidate):
                with self.assertRaises(PrivateScreenshotPathError):
                    resolve_private_screenshot_path(candidate, self.root)

    @unittest.skipIf(os.name == "nt", "Creating symlinks may require Windows developer mode")
    def test_rejects_symlink_even_when_target_is_private(self):
        target = self.root / "target.png"
        target.write_bytes(b"png")
        link = self.root / "link.png"
        link.symlink_to(target)
        with self.assertRaises(PrivateScreenshotPathError):
            resolve_private_screenshot_path(link, self.root)
