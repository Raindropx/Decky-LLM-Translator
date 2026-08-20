import io
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

try:
    from PIL import Image
except ImportError:
    Image = None

PROVIDER_DIR = Path(__file__).resolve().parents[1] / "py_modules" / "providers"
TEST_PACKAGE = "decky_llm_test_providers"
package = types.ModuleType(TEST_PACKAGE)
package.__path__ = [str(PROVIDER_DIR)]
sys.modules[TEST_PACKAGE] = package

for module_name in ("base", "language_names", "llm_translation"):
    spec = importlib.util.spec_from_file_location(
        f"{TEST_PACKAGE}.{module_name}", PROVIDER_DIR / f"{module_name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

from decky_llm_test_providers.llm_translation import (
    LLMConfigurationError,
    LLMResponseError,
    SYSTEM_PROMPT,
    _annotate_screenshot,
    _annotate_screenshot_with_bundled_python,
    _chat_completions_url,
    build_ocr_items,
    build_translation_request,
    parse_translation_json,
)


class LLMTranslationTests(unittest.TestCase):
    def test_chat_completions_url(self):
        self.assertEqual(
            _chat_completions_url("https://example.test/v1"),
            "https://example.test/v1/chat/completions",
        )
        self.assertEqual(
            _chat_completions_url("http://127.0.0.1:1234/v1/chat/completions"),
            "http://127.0.0.1:1234/v1/chat/completions",
        )

    def test_chat_completions_url_rejects_unsafe_schemes(self):
        with self.assertRaises(LLMConfigurationError):
            _chat_completions_url("file:///etc/passwd")

    def test_parser_filters_unknown_ids_and_non_strings(self):
        raw = '{"ocr-1":"翻译一","unknown":"drop","ocr-2":42}'
        self.assertEqual(
            parse_translation_json(raw, {"ocr-1", "ocr-2"}),
            {"ocr-1": "翻译一"},
        )

    def test_parser_accepts_single_json_fence(self):
        raw = '```json\n{"ocr-1":"Translated"}\n```'
        self.assertEqual(
            parse_translation_json(raw, {"ocr-1"}),
            {"ocr-1": "Translated"},
        )

    def test_parser_rejects_explanatory_text(self):
        with self.assertRaises(LLMResponseError):
            parse_translation_json('Here is the result: {"ocr-1":"x"}', {"ocr-1"})

    def test_prompt_requires_silent_conservative_ocr_correction(self):
        self.assertIn("silently reconstruct", SYSTEM_PROMPT)
        self.assertIn("only when the evidence is strong", SYSTEM_PROMPT)
        self.assertIn("when uncertain, do not guess", SYSTEM_PROMPT)
        self.assertIn("never return the corrected source text", SYSTEM_PROMPT)
        self.assertIn("do not add text seen elsewhere in the image", SYSTEM_PROMPT)

    def test_ocr_items_make_noise_and_confidence_explicit(self):
        self.assertEqual(
            build_ocr_items([
                {"id": "ocr-1", "text": "lnventory", "confidence": 0.612345},
                {"id": "ocr-2", "text": "Alduin", "confidence": "unknown"},
            ]),
            [
                {"id": "ocr-1", "ocrText": "lnventory", "ocrConfidence": 0.6123},
                {"id": "ocr-2", "ocrText": "Alduin"},
            ],
        )

    def test_model_request_expands_builtin_language_codes(self):
        request = build_translation_request(
            [{"id": "ocr-1", "text": "Terve"}],
            target_language="zh-TW",
            source_language="fi",
        )

        self.assertEqual(request["sourceLanguage"], "Finnish")
        self.assertEqual(request["targetLanguage"], "Traditional Chinese")

    def test_model_request_preserves_custom_language_definition(self):
        definition = "Traditional Chinese using Hong Kong vocabulary"
        request = build_translation_request(
            [{"id": "ocr-1", "text": "Save"}],
            target_language=definition,
        )

        self.assertEqual(request["sourceLanguage"], "auto-detect")
        self.assertEqual(request["targetLanguage"], definition)

    @unittest.skipIf(Image is None, "Pillow is not installed in the host test environment")
    def test_annotated_screenshot_is_compressed_jpeg(self):
        source = Image.new("RGB", (1600, 900), "navy")
        buffer = io.BytesIO()
        source.save(buffer, format="PNG")
        result = _annotate_screenshot(
            buffer.getvalue(),
            [{
                "id": "ocr-1",
                "text": "Charge",
                "rect": {"left": 100, "top": 100, "right": 400, "bottom": 180},
            }],
        )
        with Image.open(io.BytesIO(result)) as annotated:
            self.assertEqual(annotated.format, "JPEG")
            self.assertLessEqual(max(annotated.size), 1280)

    def test_bundled_annotation_uses_runtime_and_isolated_pythonpath(self):
        completed = types.SimpleNamespace(returncode=0, stdout=b"jpeg", stderr=b"")
        runtime = types.ModuleType(f"{TEST_PACKAGE}.python_runtime")
        runtime.find_python = mock.Mock(return_value="/plugin/bin/python3.13")

        with mock.patch.dict(sys.modules, {runtime.__name__: runtime}):
            with mock.patch("subprocess.run", return_value=completed) as run:
                with mock.patch("os.path.isfile", return_value=True):
                    with mock.patch("os.path.isdir", return_value=True):
                        result = _annotate_screenshot_with_bundled_python(b"png", [])

        self.assertEqual(result, b"jpeg")
        command = run.call_args.args[0]
        self.assertEqual(command[0], "/plugin/bin/python3.13")
        self.assertTrue(command[1].endswith("annotate_screenshot_subprocess.py"))
        self.assertEqual(run.call_args.kwargs["env"]["PYTHONNOUSERSITE"], "1")
        self.assertIn("bin", run.call_args.kwargs["env"]["PYTHONPATH"])


if __name__ == "__main__":
    unittest.main()
