import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "py_modules"
    / "providers"
    / "settings_io.py"
)
spec = importlib.util.spec_from_file_location("settings_io", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

write_settings_updates = module.write_settings_updates


class SettingsIoTests(unittest.TestCase):
    def test_merges_multiple_settings_in_one_replace(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "settings.json"
            settings_path.write_text(json.dumps({"unrelated": 1}), encoding="utf-8")

            result = write_settings_updates(
                str(settings_path),
                {"custom_languages": [{"alias": "Yue", "definition": "Cantonese"}],
                 "target_language": "Cantonese"},
            )

            self.assertEqual(result["unrelated"], 1)
            self.assertEqual(result["target_language"], "Cantonese")
            self.assertEqual(json.loads(settings_path.read_text(encoding="utf-8")), result)

    def test_failed_replace_preserves_original_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "settings.json"
            original = {"target_language": "English"}
            settings_path.write_text(json.dumps(original), encoding="utf-8")

            with mock.patch.object(module.os, "replace", side_effect=OSError("replace failed")):
                with self.assertRaisesRegex(OSError, "replace failed"):
                    write_settings_updates(
                        str(settings_path),
                        {"target_language": "Cantonese", "custom_languages": []},
                    )

            self.assertEqual(json.loads(settings_path.read_text(encoding="utf-8")), original)
            self.assertFalse(Path(f"{settings_path}.tmp").exists())


if __name__ == "__main__":
    unittest.main()
