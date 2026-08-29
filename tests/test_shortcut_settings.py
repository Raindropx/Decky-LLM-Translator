import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "py_modules"
    / "providers"
    / "shortcut_settings.py"
)
spec = importlib.util.spec_from_file_location("shortcut_settings", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

choose_distinct_ask_ai_input_mode = module.choose_distinct_ask_ai_input_mode
normalize_input_mode = module.normalize_input_mode


class ShortcutSettingsTests(unittest.TestCase):
    def test_preserves_a_valid_distinct_ask_ai_shortcut(self):
        self.assertEqual(choose_distinct_ask_ai_input_mode(2, 8), 8)

    def test_replaces_a_conflicting_ask_ai_shortcut(self):
        replacement = choose_distinct_ask_ai_input_mode(3, 3)
        self.assertNotEqual(replacement, 3)
        self.assertEqual(replacement, 1)

    def test_rejects_unknown_and_boolean_input_modes(self):
        for value in (-1, 10, True, "3", None):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_input_mode(value)


if __name__ == "__main__":
    unittest.main()
