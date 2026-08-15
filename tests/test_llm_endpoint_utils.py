import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "py_modules"
    / "providers"
    / "llm_endpoint_utils.py"
)
spec = importlib.util.spec_from_file_location("llm_endpoint_utils", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

next_endpoint_copy_name = module.next_endpoint_copy_name


class LLMEndpointUtilsTests(unittest.TestCase):
    def test_copy_name_starts_at_two(self):
        self.assertEqual(
            next_endpoint_copy_name("OpenRouter", ["OpenRouter"]),
            "OpenRouter 2",
        )

    def test_copy_name_skips_existing_names_case_insensitively(self):
        self.assertEqual(
            next_endpoint_copy_name(
                "OpenRouter",
                ["OpenRouter", "openrouter 2", "OpenRouter 3"],
            ),
            "OpenRouter 4",
        )

    def test_copy_name_stays_within_endpoint_name_limit(self):
        copied_name = next_endpoint_copy_name("x" * 80, ["x" * 80])
        self.assertEqual(len(copied_name), 80)
        self.assertTrue(copied_name.endswith(" 2"))


if __name__ == "__main__":
    unittest.main()
