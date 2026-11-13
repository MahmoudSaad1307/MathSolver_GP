import base64
import io
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from PIL import Image, ImageOps
from config import Settings, get_settings
from core.parsing import parse_expr_safe
from llm.client import GroqClientWrapper
from llm.ollama_fallback import OllamaClientWrapper
from llm.prompts import OCR_PROMPT

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class OCRFlag:
    line_number: Optional[int]  # 1-indexed, or None if global
    flag_type: str              # "unsure", "unparsable", "disagree", "line_count_mismatch", "single_reader"
    message: str

@dataclass
class OCRResult:
    lines: List[str]
    flags: List[OCRFlag]
    raw_reader1: List[Dict[str, Any]]
    raw_reader2: Optional[List[Dict[str, Any]]] = None

def preprocess_image(image: Image.Image) -> str:
    """
    Image preprocessing pipeline:
    1. EXIF orientation correction
    2. Convert to grayscale
    3. Autocontrast (cutoff=1%)
    4. Upscale if max side < 1000px
    5. Thumbnail/downscale to 1800px max side
    6. Save to JPEG q90 with size check; lower quality if > 3.5MB
    Returns base64 encoded string.
    """
    # 1. EXIF transpose
    img = ImageOps.exif_transpose(image)
    if img is None:
        img = image

    # 2. Grayscale
    img = img.convert("L")

    # 3. Autocontrast
    img = ImageOps.autocontrast(img, cutoff=1)

    # 4. Upscale if small
    w, h = img.size
    max_side = max(w, h)
    if max_side < 1000 and max_side > 0:
        scale = 1000.0 / max_side
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # 5. Thumbnail downscale if huge
    img.thumbnail((1800, 1800), Image.Resampling.LANCZOS)

    # 6. JPEG compression with stepping if file size exceeds 3.5MB
    quality = 90
    max_bytes = 3_500_000

    while quality >= 40:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        raw_bytes = buf.getvalue()
        if len(raw_bytes) <= max_bytes or quality <= 40:
            return base64.b64encode(raw_bytes).decode("utf-8")
        quality -= 15

    return base64.b64encode(buf.getvalue()).decode("utf-8")

def normalize_line_for_comparison(text: str) -> str:
    """Normalize mathematical lines to compare model agreements."""
    s = text.strip().lower()
    s = re.sub(r"\s+", "", s)
    s = s.replace("^", "**")
    return s

def build_ocr_flags(
    lines1: List[Dict[str, Any]],
    lines2: Optional[List[Dict[str, Any]]],
    single_reader: bool = False,
) -> List[OCRFlag]:
    """
    Build flags for user verification:
    - Single reader available
    - Line counts differ
    - Model said 'unsure'
    - Models disagree on line
    - SymPy cannot parse line
    """
    flags: List[OCRFlag] = []

    if single_reader or lines2 is None:
        flags.append(
            OCRFlag(
                line_number=None,
                flag_type="single_reader",
                message="تم استخدام قارئ واحد فقط للتعرف على الصورة (تعذر تشغيل القارئ الثاني أو تم استخدام وضع Ollama).",
            )
        )

    # Line count mismatch
    if lines2 is not None and len(lines1) != len(lines2):
        flags.append(
            OCRFlag(
                line_number=None,
                flag_type="line_count_mismatch",
                message=f"اختلاف في عدد الأسطر المقروءة بين النموذجين ({len(lines1)} سطر مقابل {len(lines2)} سطر).",
            )
        )

    total_lines = len(lines1)
    for i in range(total_lines):
        line_num = i + 1
        item1 = lines1[i]
        text1 = str(item1.get("t", "")).strip()
        unsure1 = bool(item1.get("unsure", False))

        # Check unsure flag
        if unsure1:
            flags.append(
                OCRFlag(
                    line_number=line_num,
                    flag_type="unsure",
                    message=f"السطر {line_num}: النموذج غير واثق تماماً من وضوح الخط ('{text1}').",
                )
            )

        # Check model disagreement
        if lines2 is not None and i < len(lines2):
            item2 = lines2[i]
            text2 = str(item2.get("t", "")).strip()
            unsure2 = bool(item2.get("unsure", False))

            if unsure2 and not unsure1:
                flags.append(
                    OCRFlag(
                        line_number=line_num,
                        flag_type="unsure",
                        message=f"السطر {line_num}: القارئ الثاني غير واثق من قراءة السطر.",
                    )
                )

            norm1 = normalize_line_for_comparison(text1)
            norm2 = normalize_line_for_comparison(text2)
            if norm1 != norm2:
                flags.append(
                    OCRFlag(
                        line_number=line_num,
                        flag_type="disagree",
                        message=f"السطر {line_num}: اختلاف بين القراءتين: '{text1}' مقابل '{text2}'.",
                    )
                )

        # Check SymPy parseability
        if text1:
            parsed = parse_expr_safe(text1)
            if parsed is None:
                flags.append(
                    OCRFlag(
                        line_number=line_num,
                        flag_type="unparsable",
                        message=f"السطر {line_num}: تعذر تفسير التعبير كصيغة رياضية في SymPy: '{text1}'.",
                    )
                )

    return flags

def read_image_dual_model(
    image: Image.Image,
    settings: Optional[Settings] = None,
    groq_client: Optional[GroqClientWrapper] = None,
    ollama_client: Optional[OllamaClientWrapper] = None,
) -> OCRResult:
    """
    Main OCR pipeline:
    1. Preprocesses the image into optimized base64.
    2. Calls two distinct vision models.
    3. Handles 429 and fallback to Ollama.
    4. Generates flags for user confirmation.
    """
    s = settings or get_settings()
    img_b64 = preprocess_image(image)

    g_client = groq_client or GroqClientWrapper(s)
    o_client = ollama_client or OllamaClientWrapper(s)

    lines_model1: Optional[List[Dict[str, Any]]] = None
    lines_model2: Optional[List[Dict[str, Any]]] = None
    single_reader = False

    if s.is_groq_ready():
        vision_models = s.groq_vision_models
        # Try model 1
        if len(vision_models) > 0:
            try:
                res1 = g_client.vision_ocr(img_b64, OCR_PROMPT, vision_models[0])
                lines_model1 = res1.get("lines", [])
            except Exception as e:
                logger.warning(f"Groq vision model {vision_models[0]} failed: {e}")

        # Try model 2
        if len(vision_models) > 1:
            try:
                res2 = g_client.vision_ocr(img_b64, OCR_PROMPT, vision_models[1])
                lines_model2 = res2.get("lines", [])
            except Exception as e:
                logger.warning(f"Groq vision model {vision_models[1]} failed: {e}")

    # Fallback to Ollama if needed
    if lines_model1 is None:
        logger.info("Falling back to Ollama vision model...")
        try:
            res_ollama = o_client.vision_ocr(img_b64, OCR_PROMPT)
            lines_model1 = res_ollama.get("lines", [])
            single_reader = True
        except Exception as oe:
            logger.error(f"Ollama vision OCR also failed: {oe}")
            raise RuntimeError(
                "تعذر قراءة الصورة: فشلت جميع نماذج الرؤية المتاحة (Groq و Ollama). "
                "يرجى التحقق من اتصال الإنترنت أو تشغيل Ollama محلياً."
            )

    if lines_model2 is None:
        single_reader = True

    final_lines = [str(item.get("t", "")).strip() for item in lines_model1 if str(item.get("t", "")).strip()]
    flags = build_ocr_flags(lines_model1, lines_model2, single_reader=single_reader)

    return OCRResult(
        lines=final_lines,
        flags=flags,
        raw_reader1=lines_model1,
        raw_reader2=lines_model2,
    )
