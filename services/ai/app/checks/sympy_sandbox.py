from __future__ import annotations

import atexit
import json
import queue
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from app.schemas import SympyCheckResult

_ALLOWED_LATEX_CHARS = re.compile(r"^[A-Za-z0-9\s\\{}_^+\-*/=.,()\[\]|<>:'!$&%]*$")
_FORBIDDEN_SUBSTRINGS = (
    "__",
    "import",
    "eval",
    "exec",
    "open(",
    "lambda",
    "os.",
    "sys.",
    "subprocess",
)
_SERVICE_ROOT = Path(__file__).resolve().parents[2]


def is_safe_math_input(raw: str) -> bool:
    if not raw or len(raw) > 600:
        return False
    lowered = raw.lower()
    if any(token in lowered for token in _FORBIDDEN_SUBSTRINGS):
        return False
    return bool(_ALLOWED_LATEX_CHARS.fullmatch(raw))


class _SympySandboxRunner:
    """Persistent isolated worker process with hard timeout + automatic respawn."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None
        self._lines: queue.Queue[str | None] = queue.Queue()

    def _kill(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=2.0)
            except Exception:
                pass
            self._proc = None

    def _start(self) -> None:
        self._kill()
        self._lines = queue.Queue()
        proc = subprocess.Popen(
            [sys.executable, "-u", "-m", "app.checks._sandbox_worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            cwd=str(_SERVICE_ROOT),
        )
        self._proc = proc

        def reader() -> None:
            assert proc.stdout is not None
            try:
                for raw_line in proc.stdout:
                    self._lines.put(raw_line)
            finally:
                self._lines.put(None)

        t = threading.Thread(target=reader, daemon=True)
        t.start()

        # Wait up to 15s for initial SymPy/Lark worker boot
        ready_line = self._lines.get(timeout=15.0)
        if not ready_line or '"ready": true' not in ready_line:
            self._kill()
            raise RuntimeError("SymPy sandbox failed to signal readiness")

    def run(self, student_latex: str, expected_expr: str, timeout_seconds: float) -> dict[str, Any]:
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()

            assert self._proc is not None and self._proc.stdin is not None
            payload = json.dumps({"student": student_latex, "expected": expected_expr}) + "\n"
            try:
                self._proc.stdin.write(payload)
                self._proc.stdin.flush()
                line = self._lines.get(timeout=timeout_seconds)
            except queue.Empty as exc:
                self._kill()
                raise TimeoutError("SymPy worker timed out") from exc
            except Exception as exc:
                self._kill()
                raise RuntimeError(f"SymPy worker pipe failed: {exc}") from exc

            if not line:
                self._kill()
                raise RuntimeError("SymPy worker closed unexpectedly")
            parsed: dict[str, Any] = json.loads(line)
            return parsed

    def close(self) -> None:
        with self._lock:
            self._kill()


_SANDBOX_RUNNER = _SympySandboxRunner()
atexit.register(_SANDBOX_RUNNER.close)


def compare_expressions_in_sandbox(
    student_latex: str,
    expected_expr: str,
    *,
    timeout_seconds: float = 3.0,
) -> SympyCheckResult:
    if not is_safe_math_input(student_latex) or not is_safe_math_input(expected_expr):
        return SympyCheckResult(
            checked=False,
            status="UNPARSABLE",
            studentFinalSympy=None,
            expectedFinalSympy=expected_expr,
            equivalent=None,
            detail="Rejected expression due to unsafe characters or length limit",
        )

    try:
        data = _SANDBOX_RUNNER.run(student_latex, expected_expr, timeout_seconds)
    except TimeoutError:
        return SympyCheckResult(
            checked=True,
            status="TIMEOUT",
            studentFinalSympy=None,
            expectedFinalSympy=expected_expr,
            equivalent=None,
            detail=f"SymPy verification timed out after {timeout_seconds:.1f}s",
        )
    except Exception as exc:
        return SympyCheckResult(
            checked=True,
            status="UNPARSABLE",
            studentFinalSympy=None,
            expectedFinalSympy=expected_expr,
            equivalent=None,
            detail=f"SymPy sandbox failure: {exc}",
        )

    raw_status = str(data.get("status", "UNPARSABLE"))
    status_val = (
        raw_status
        if raw_status in ("EQUIVALENT", "NOT_EQUIVALENT", "UNPARSABLE", "TIMEOUT", "NOT_APPLICABLE")
        else "UNPARSABLE"
    )
    equiv_raw = data.get("equivalent")
    equiv_val: bool | None = bool(equiv_raw) if isinstance(equiv_raw, bool) else None

    return SympyCheckResult(
        checked=True,
        status=status_val,  # type: ignore[arg-type]
        studentFinalSympy=(
            str(data["studentSympy"]) if data.get("studentSympy") is not None else None
        ),
        expectedFinalSympy=(
            str(data["expectedSympy"]) if data.get("expectedSympy") is not None else expected_expr
        ),
        equivalent=equiv_val,
        detail=str(data.get("detail", "")),
    )
