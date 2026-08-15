import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "py_modules"
    / "providers"
    / "custom_languages.py"
)
spec = importlib.util.spec_from_file_location("custom_languages", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

normalize_custom_languages = module.normalize_custom_languages


class CustomLanguageTests(unittest.TestCase):
    def test_normalizes_alias_and_definition(self):
        self.assertEqual(
            normalize_custom_languages([
                {"alias": "  Cantonese  ", "definition": "  Cantonese written in Traditional Chinese  "},
            ]),
            [{"alias": "Cantonese", "definition": "Cantonese written in Traditional Chinese"}],
        )

    def test_rejects_missing_fields(self):
        with self.assertRaises(ValueError):
            normalize_custom_languages([{"alias": "Cantonese"}])

    def test_allows_alias_and_definition_to_match(self):
        self.assertEqual(
            normalize_custom_languages([{"alias": "toki pona", "definition": "toki pona"}]),
            [{"alias": "toki pona", "definition": "toki pona"}],
        )

    def test_rejects_duplicate_aliases_case_insensitively(self):
        with self.assertRaises(ValueError):
            normalize_custom_languages([
                {"alias": "Cantonese", "definition": "Cantonese"},
                {"alias": "cantonese", "definition": "Colloquial Cantonese"},
            ])

    def test_rejects_duplicate_definitions(self):
        with self.assertRaises(ValueError):
            normalize_custom_languages([
                {"alias": "Cantonese", "definition": "Cantonese"},
                {"alias": "Yue", "definition": "Cantonese"},
            ])


if __name__ == "__main__":
    unittest.main()
