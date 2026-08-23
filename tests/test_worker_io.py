import importlib.util
import threading
import time
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "py_modules" / "providers" / "worker_io.py"
spec = importlib.util.spec_from_file_location("worker_io", MODULE_PATH)
worker_io = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker_io)
WorkerResponseTimeout = worker_io.WorkerResponseTimeout
readline_with_timeout = worker_io.readline_with_timeout


class _BlockingStream:
    def __init__(self, line=b"ready\n"):
        self.release = threading.Event()
        self.line = line

    def readline(self):
        self.release.wait()
        return self.line


class WorkerIOTests(unittest.TestCase):
    def test_returns_worker_line(self):
        stream = _BlockingStream()
        stream.release.set()
        self.assertEqual(readline_with_timeout(stream, 0.5), b"ready\n")

    def test_times_out_instead_of_blocking_forever(self):
        stream = _BlockingStream()
        started = time.monotonic()
        try:
            with self.assertRaises(WorkerResponseTimeout):
                readline_with_timeout(stream, 0.02)
            self.assertLess(time.monotonic() - started, 0.5)
        finally:
            stream.release.set()
