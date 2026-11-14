from __future__ import annotations

import base64
import binascii
import io
from dataclasses import dataclass

import numpy as np
import pymupdf
from PIL import Image


class PdfValidationError(Exception):
    """Domain error raised when an uploaded PDF fails structural or page-limit checks."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class PreprocessedPdfPage:
    page_number: int
    native_text: str
    has_text_layer: bool
    has_equation_artifacts: bool
    is_blank: bool
    image_b64: str
    mime_type: str = "image/jpeg"


def decode_pdf_base64(pdf_base64: str) -> bytes:
    """Decode raw or data-URI base64 PDF payload and validate the PDF header."""
    payload = pdf_base64.strip()
    if payload.startswith("data:") and "," in payload:
        payload = payload.split(",", 1)[1]
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PdfValidationError("PDF_INVALID", f"Invalid base64 PDF payload: {exc}", 400) from exc

    if not raw.startswith(b"%PDF-"):
        raise PdfValidationError("PDF_INVALID", "File does not start with valid %PDF- header", 400)
    return raw


def _detect_equation_artifacts(text: str) -> bool:
    """Return True if Word Equation Editor private-use or replacement glyphs appear."""
    if "\ufffd" in text:
        return True
    return any(0xF000 <= ord(ch) <= 0xF8FF for ch in text)


def _render_page_to_jpeg_b64(page: pymupdf.Page, *, dpi: int, max_side: int) -> tuple[str, bool]:
    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

    if max(image.width, image.height) > max_side:
        image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    gray_arr = np.asarray(image.convert("L"), dtype=np.float32)
    dark_pixels = int((gray_arr < 245).sum())
    is_low_variance = float(gray_arr.std()) < 1.0 and dark_pixels < 50

    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii"), is_low_variance


def preprocess_pdf_document(
    pdf_base64: str,
    *,
    max_pages: int = 40,
    dpi: int = 200,
    max_side: int = 2000,
) -> list[PreprocessedPdfPage]:
    """Validate, extract native text, and rasterize each PDF page to capped 200-DPI JPEG."""
    raw_bytes = decode_pdf_base64(pdf_base64)
    try:
        doc = pymupdf.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:
        raise PdfValidationError(
            "PDF_INVALID", f"Could not parse PDF document: {exc}", 400
        ) from exc

    try:
        page_count = len(doc)
        if page_count == 0:
            raise PdfValidationError("PDF_INVALID", "PDF contains zero pages", 400)
        if page_count > max_pages:
            raise PdfValidationError(
                "PDF_TOO_MANY_PAGES",
                f"PDF has {page_count} pages; maximum allowed is {max_pages}",
                422,
            )

        rendered: list[PreprocessedPdfPage] = []
        for idx in range(page_count):
            page = doc.load_page(idx)
            native_text = str(page.get_text("text") or "").strip()
            has_text_layer = len(native_text) >= 15
            has_eq_artifacts = _detect_equation_artifacts(native_text)
            image_b64, is_low_variance = _render_page_to_jpeg_b64(page, dpi=dpi, max_side=max_side)
            is_blank = is_low_variance and len(native_text) < 5
            rendered.append(
                PreprocessedPdfPage(
                    page_number=idx + 1,
                    native_text=native_text,
                    has_text_layer=has_text_layer,
                    has_equation_artifacts=has_eq_artifacts,
                    is_blank=is_blank,
                    image_b64=image_b64,
                )
            )
        return rendered
    finally:
        doc.close()
