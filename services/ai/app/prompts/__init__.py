from pathlib import Path

PROMPT_DIR = Path(__file__).resolve().parent
PROMPT_VERSION_TRANSCRIBE = "transcribe.v1"
PROMPT_VERSION_GRADE = "grade.v1"
PROMPT_VERSION_PDF_SEGMENT = "pdf_segment.v1"
PROMPT_VERSION_PDF_OCR_WINDOW = "pdf_ocr_window.v1"
PROMPT_VERSION_PDF_STRUCTURE_PAIR = "pdf_structure_pair.v1"


def load_prompt(name: str) -> str:
    path = PROMPT_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8")
