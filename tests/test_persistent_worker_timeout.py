import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


PROVIDER_DIR = Path(__file__).resolve().parents[1] / "py_modules" / "providers"
TEST_PACKAGE = "decky_llm_worker_test_providers"
package = types.ModuleType(TEST_PACKAGE)
package.__path__ = [str(PROVIDER_DIR)]
sys.modules[TEST_PACKAGE] = package

for module_name in (
    "base",
    "python_runtime",
    "worker_io",
    "rapidocr_provider",
    "chromescreenai_provider",
):
    spec = importlib.util.spec_from_file_location(
        f"{TEST_PACKAGE}.{module_name}",
        PROVIDER_DIR / f"{module_name}.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

rapidocr_provider = sys.modules[f"{TEST_PACKAGE}.rapidocr_provider"]
chromescreenai_provider = sys.modules[f"{TEST_PACKAGE}.chromescreenai_provider"]


class _FakePipe:
    def __init__(self):
        self.writes = []
        self.closed = False

    def write(self, data):
        self.writes.append(data)

    def flush(self):
        pass

    def close(self):
        self.closed = True


class _FakeWorker:
    def __init__(self):
        self.stdin = _FakePipe()
        self.stdout = _FakePipe()
        self.stderr = _FakePipe()
        self.running = True

    def poll(self):
        return None if self.running else 0

    def wait(self, timeout=None):
        self.running = False
        return 0

    def terminate(self):
        self.running = False

    def kill(self):
        self.running = False


class PersistentWorkerTimeoutTests(unittest.TestCase):
    def assert_timeout_discards_worker(self, module, provider, invoke):
        worker = _FakeWorker()
        provider._worker_proc = worker
        with mock.patch.object(
            module,
            "readline_with_timeout",
            side_effect=module.WorkerResponseTimeout("deadline reached"),
        ):
            self.assertIsNone(invoke())
        self.assertIsNone(provider._worker_proc)
        self.assertFalse(worker.running)

    def test_rapidocr_timeout_discards_stuck_worker(self):
        provider = rapidocr_provider.RapidOCRProvider()
        self.assert_timeout_discards_worker(
            rapidocr_provider,
            provider,
            lambda: provider._recognize_via_worker(b"image", "auto"),
        )

    def test_chrome_screen_ai_timeout_discards_stuck_worker(self):
        provider = chromescreenai_provider.ChromeScreenAIProvider()
        self.assert_timeout_discards_worker(
            chromescreenai_provider,
            provider,
            lambda: provider._recognize_via_worker(b"image"),
        )
