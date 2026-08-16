import importlib.util
import io
import os
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "py_modules" / "providers" / "steam_screenshots.py"
spec = importlib.util.spec_from_file_location("steam_screenshots", MODULE_PATH)
steam_screenshots = importlib.util.module_from_spec(spec)
spec.loader.exec_module(steam_screenshots)


class SteamScreenshotTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.home = Path(self.temp_dir.name)
        self.app_id = "16723070210621308928"
        self.screenshot_dir = (
            self.home
            / ".local"
            / "share"
            / "Steam"
            / "userdata"
            / "78401669"
            / "760"
            / "remote"
            / self.app_id
            / "screenshots"
        )
        (self.screenshot_dir / "thumbnails").mkdir(parents=True)

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def image_bytes(size=(1280, 800), color=(20, 30, 40), image_format="JPEG"):
        output = io.BytesIO()
        Image.new("RGB", size, color).save(output, format=image_format, quality=90)
        return output.getvalue()

    def test_lossless_large_non_steam_app_id_directory(self):
        directories = steam_screenshots.screenshot_directories(self.home, self.app_id)
        self.assertEqual(directories, [self.screenshot_dir.resolve()])
        self.assertEqual(steam_screenshots.normalize_app_id(self.app_id), self.app_id)

    def test_finds_latest_full_size_file_but_not_thumbnail(self):
        older = self.screenshot_dir / "older.jpg"
        latest = self.screenshot_dir / "latest.jpg"
        thumbnail = self.screenshot_dir / "thumbnails" / "latest.jpg"
        older.write_bytes(self.image_bytes())
        latest.write_bytes(self.image_bytes(color=(60, 70, 80)))
        thumbnail.write_bytes(self.image_bytes(size=(200, 125)))
        os.utime(older, (100, 100))
        os.utime(latest, (200, 200))
        os.utime(thumbnail, (300, 300))

        result = steam_screenshots.find_latest_screenshot(self.home, self.app_id, 150)
        self.assertEqual(result, latest)

    def test_falls_back_to_latest_screenshot_across_apps(self):
        screenshot = self.screenshot_dir / "latest.jpg"
        screenshot.write_bytes(self.image_bytes())
        os.utime(screenshot, (200, 200))

        result = steam_screenshots.find_latest_screenshot_any_app(self.home, 150)
        self.assertEqual(result, screenshot)

    def test_finds_screenshot_when_decky_home_points_to_homebrew(self):
        screenshot = self.screenshot_dir / "latest.jpg"
        screenshot.write_bytes(self.image_bytes())
        os.utime(screenshot, (200, 200))
        decky_home = self.home / "homebrew"
        decky_home.mkdir()

        result = steam_screenshots.find_latest_screenshot(
            decky_home,
            self.app_id,
            150,
        )
        self.assertEqual(result, screenshot)

    def test_generated_copy_can_be_excluded_from_capture_discovery(self):
        native = self.screenshot_dir / "20260817013334_1.jpg"
        translated = self.screenshot_dir / "20260817013334_2.jpg"
        native.write_bytes(self.image_bytes())
        translated.write_bytes(self.image_bytes(color=(180, 10, 20)))
        os.utime(native, (200, 200))
        os.utime(translated, (201, 201))

        result = steam_screenshots.find_latest_screenshot(
            self.home,
            self.app_id,
            150,
            excluded_paths=[translated],
        )
        self.assertEqual(result, native)

    def test_atomically_replaces_image_and_thumbnail(self):
        screenshot = self.screenshot_dir / "20260817013334_1.jpg"
        thumbnail = self.screenshot_dir / "thumbnails" / screenshot.name
        screenshot.write_bytes(self.image_bytes())
        thumbnail.write_bytes(self.image_bytes(size=(200, 125)))
        replacement = self.image_bytes(color=(180, 10, 20))

        result = steam_screenshots.replace_screenshot_and_thumbnail(
            self.home, self.app_id, screenshot, replacement
        )

        self.assertTrue(result["thumbnail_updated"])
        with Image.open(screenshot) as image:
            self.assertEqual(image.size, (1280, 800))
            self.assertGreater(image.getpixel((10, 10))[0], 150)
        with Image.open(thumbnail) as image:
            self.assertLessEqual(image.width, 200)
            self.assertLessEqual(image.height, 125)

    def test_rejects_dimension_change_without_touching_original(self):
        screenshot = self.screenshot_dir / "shot.jpg"
        original = self.image_bytes()
        screenshot.write_bytes(original)

        with self.assertRaises(ValueError):
            steam_screenshots.replace_screenshot_and_thumbnail(
                self.home,
                self.app_id,
                screenshot,
                self.image_bytes(size=(1920, 1080)),
            )

        self.assertEqual(screenshot.read_bytes(), original)

    def test_copy_mode_preserves_original_and_creates_numbered_translation(self):
        screenshot = self.screenshot_dir / "20260817013334_1.jpg"
        thumbnail = self.screenshot_dir / "thumbnails" / screenshot.name
        original = self.image_bytes()
        original_thumbnail = self.image_bytes(size=(200, 125))
        screenshot.write_bytes(original)
        thumbnail.write_bytes(original_thumbnail)

        result = steam_screenshots.create_translated_screenshot_copy(
            self.home,
            self.app_id,
            screenshot,
            self.image_bytes(color=(180, 10, 20)),
        )

        translated = self.screenshot_dir / "20260817013334_2.jpg"
        translated_thumbnail = self.screenshot_dir / "thumbnails" / translated.name
        self.assertEqual(result["mode"], "copy")
        self.assertEqual(Path(result["path"]), translated)
        self.assertEqual(screenshot.read_bytes(), original)
        self.assertEqual(thumbnail.read_bytes(), original_thumbnail)
        self.assertTrue(translated.is_file())
        self.assertTrue(translated_thumbnail.is_file())
        with Image.open(translated) as image:
            self.assertGreater(image.getpixel((10, 10))[0], 150)

    def test_copy_mode_never_overwrites_an_existing_numbered_copy(self):
        screenshot = self.screenshot_dir / "20260817013334_1.jpg"
        existing = self.screenshot_dir / "20260817013334_2.jpg"
        screenshot.write_bytes(self.image_bytes())
        existing_bytes = self.image_bytes(color=(80, 90, 100))
        existing.write_bytes(existing_bytes)

        result = steam_screenshots.create_translated_screenshot_copy(
            self.home,
            self.app_id,
            screenshot,
            self.image_bytes(color=(180, 10, 20)),
        )

        self.assertEqual(existing.read_bytes(), existing_bytes)
        self.assertEqual(
            Path(result["path"]),
            self.screenshot_dir / "20260817013334_3.jpg",
        )


if __name__ == "__main__":
    unittest.main()
