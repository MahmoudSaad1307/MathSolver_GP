from __future__ import annotations

import base64
import hashlib
import io
from dataclasses import dataclass, field

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps


@dataclass(frozen=True)
class PreprocessOutcome:
    processed_base64: str
    mime_type: str
    sha256: str
    width: int
    height: int
    laplacian_var: float
    is_blurry: bool
    is_blank: bool
    foreground_ratio: float
    skew_angle_deg: float
    warnings: list[str] = field(default_factory=list)


def _decode_base64_image(data_b64: str) -> bytes:
    cleaned = data_b64.strip()
    if "," in cleaned and cleaned.startswith("data:"):
        cleaned = cleaned.split(",", 1)[1]
    return base64.b64decode(cleaned)


def _compute_skew_angle(binary_inv: NDArray[np.uint8]) -> float:
    coords = cv2.findNonZero(binary_inv)
    if coords is None or len(coords) < 25:
        return 0.0
    rect = cv2.minAreaRect(coords)
    angle = float(rect[2])
    if angle < -45.0:
        angle = 90.0 + angle
    elif angle > 45.0:
        angle = angle - 90.0
    # Only deskew mild camera tilts between 0.8 and 15 degrees
    if abs(angle) < 0.8 or abs(angle) > 15.0:
        return 0.0
    return angle


def _rotate_gray(gray: NDArray[np.uint8], angle_deg: float) -> NDArray[np.uint8]:
    h, w = gray.shape[:2]
    center = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    rotated = cv2.warpAffine(
        gray,
        matrix,
        (w, h),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated.astype(np.uint8)


def preprocess_handwriting_image(
    data_base64: str,
    *,
    blur_laplacian_min: float = 45.0,
    min_long_edge: int = 900,
    max_long_edge: int = 1600,
) -> PreprocessOutcome:
    raw_bytes = _decode_base64_image(data_base64)
    pil_img = Image.open(io.BytesIO(raw_bytes))
    transposed = ImageOps.exif_transpose(pil_img)
    rgb = (transposed if transposed is not None else pil_img).convert("RGB")
    rgb_arr: NDArray[np.uint8] = np.asarray(rgb, dtype=np.uint8)

    gray: NDArray[np.uint8] = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2GRAY).astype(np.uint8)

    # Measure foreground ink ratio BEFORE contrast normalization so blank pages stand out
    std_dev = float(np.std(gray))
    _, otsu_inv = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink_cutoff = min(235, int(np.mean(gray) - max(10.0, 2.0 * std_dev)))
    dark_mask = gray < ink_cutoff
    foreground_ratio = float(np.count_nonzero(dark_mask)) / float(gray.size)
    is_blank = foreground_ratio < 0.0012 or (std_dev < 1.2 and foreground_ratio < 0.002)

    # Mild deskew if text block is tilted
    skew_angle = 0.0
    if not is_blank:
        skew_angle = _compute_skew_angle(otsu_inv.astype(np.uint8))
        if abs(skew_angle) >= 0.8:
            gray = _rotate_gray(gray, skew_angle)

    # Local contrast normalization via CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced: NDArray[np.uint8] = clahe.apply(gray).astype(np.uint8)

    # Blur measurement on enhanced image (only meaningful if not blank)
    laplacian_var = float(cv2.Laplacian(enhanced, cv2.CV_64F).var())
    is_blurry = (not is_blank) and (laplacian_var < blur_laplacian_min)

    # Scale to optimal OCR bounds without distorting aspect ratio
    h, w = enhanced.shape[:2]
    long_edge = max(h, w)
    if 0 < long_edge < min_long_edge:
        scale = float(min_long_edge) / float(long_edge)
        enhanced = cv2.resize(
            enhanced,
            (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_CUBIC,
        ).astype(np.uint8)
    elif long_edge > max_long_edge:
        scale = float(max_long_edge) / float(long_edge)
        enhanced = cv2.resize(
            enhanced,
            (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        ).astype(np.uint8)

    final_h, final_w = enhanced.shape[:2]
    warnings: list[str] = []
    if is_blank:
        warnings.append("BLANK_OR_NEAR_EMPTY_PAGE")
    if is_blurry:
        warnings.append(f"LOW_SHARPNESS_LAPLACIAN_{laplacian_var:.1f}")
    if abs(skew_angle) >= 0.8:
        warnings.append(f"DESKEWED_{skew_angle:.1f}_DEG")

    # Re-encode cleanly (no EXIF)
    out_pil = Image.fromarray(enhanced, mode="L")
    out_buf = io.BytesIO()
    out_pil.save(out_buf, format="JPEG", quality=88, optimize=True)
    out_bytes = out_buf.getvalue()

    return PreprocessOutcome(
        processed_base64=base64.b64encode(out_bytes).decode("ascii"),
        mime_type="image/jpeg",
        sha256=hashlib.sha256(out_bytes).hexdigest(),
        width=final_w,
        height=final_h,
        laplacian_var=laplacian_var,
        is_blurry=is_blurry,
        is_blank=is_blank,
        foreground_ratio=foreground_ratio,
        skew_angle_deg=skew_angle,
        warnings=warnings,
    )
