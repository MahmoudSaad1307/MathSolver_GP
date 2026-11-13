from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent
PROMPT_VERSION_TRANSCRIBE = "transcribe.v1"
PROMPT_VERSION_GRADE = "grade.v1"


def load_prompt(name: str) -> str:
    path = PROMPT_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8")
