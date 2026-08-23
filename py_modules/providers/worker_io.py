import threading


class WorkerResponseTimeout(TimeoutError):
    pass


def readline_with_timeout(stream, timeout_seconds: float) -> bytes:
    """Read one worker response without allowing a pipe read to block forever."""
    completed = threading.Event()
    result = {}

    def read_line() -> None:
        try:
            result["line"] = stream.readline()
        except Exception as exc:
            result["error"] = exc
        finally:
            completed.set()

    threading.Thread(target=read_line, daemon=True).start()
    if not completed.wait(timeout_seconds):
        raise WorkerResponseTimeout(
            f"Worker did not respond within {timeout_seconds:g} seconds"
        )
    if "error" in result:
        raise result["error"]
    return result.get("line", b"")
