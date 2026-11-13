import io
import logging
import os
import sys
from pathlib import Path
from PIL import Image
import streamlit as st

# Configure module search path
APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from config import get_settings, validate_environment_or_fail
from core.check import check_student_steps
from core.parsing import parse_expr_safe
from core.simple_modes import (
    direct_differentiate,
    direct_integrate,
    direct_solve_equation,
    direct_solve_ode,
)
from core.solve import solve_verified
from llm.client import GroqClientWrapper
from llm.ocr import read_image_dual_model
from llm.ollama_fallback import OllamaClientWrapper
import sympy as sp

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("mathcheck.app")

# Page config
st.set_page_config(
    page_title="MathCheck | المصحح الرياضي الذكي",
    page_icon="🧮",
    layout="wide",
)

# Cached clients
@st.cache_resource
def get_clients():
    settings = get_settings()
    groq_client = GroqClientWrapper(settings) if settings.is_groq_ready() else None
    ollama_client = OllamaClientWrapper(settings)
    return settings, groq_client, ollama_client

# CSS RTL and Design
st.markdown(
    """
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    
    html, body, [data-testid="stAppViewContainer"], [data-testid="stHeader"] {
        direction: rtl;
        text-align: right;
        font-family: 'Cairo', sans-serif !important;
    }
    
    .stMarkdown, .stText, .stButton, .stRadio, .stTextInput, .stTextArea, .stSelectbox, .stAlert, .stExpander {
        direction: rtl;
        text-align: right;
    }
    
    .katex, .stLatex, code, pre {
        direction: ltr !important;
        text-align: center !important;
    }
    
    .step-box {
        padding: 14px 18px;
        border-radius: 10px;
        margin-bottom: 12px;
        background-color: #f8f9fa;
        border-right: 5px solid #1890ff;
    }
    .step-box-bad {
        background-color: #fff1f0;
        border-right: 5px solid #ff4d4f;
    }
    .badge-ok {
        background-color: #e6f7ff;
        color: #1890ff;
        border: 1px solid #91d5ff;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
    }
    .badge-bad {
        background-color: #fff1f0;
        color: #f5222d;
        border: 1px solid #ffa39e;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
    }
    .badge-downstream {
        background-color: #fffbe6;
        color: #fa8c16;
        border: 1px solid #ffe58f;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
    }
    .badge-unknown {
        background-color: #f5f5f5;
        color: #8c8c8c;
        border: 1px solid #d9d9d9;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# Initialize Session State
if "editable_lines" not in st.session_state:
    st.session_state["editable_lines"] = ""
if "ocr_flags" not in st.session_state:
    st.session_state["ocr_flags"] = []
if "ocr_done" not in st.session_state:
    st.session_state["ocr_done"] = False

# Fail-fast validation check
try:
    settings, groq_c, ollama_c = get_clients()
    validate_environment_or_fail(settings)
except RuntimeError as err:
    st.error(str(err))
    st.stop()

# Header
st.title("🧮 MathCheck | المصحح الرياضي الذكي")
st.caption("التحقق الرياضي الصارم بواسطة SymPy — الذكاء الاصطناعي للمساعدة وقراءة الخطوط فقط.")

# Tabs
tab_calc, tab_image = st.tabs(["🧮 حاسبة رمزية", "📷 من صورة (المصحح الآلي)"])

# -------------------------------------------------------------
# TAB 1: CALCULATOR
# -------------------------------------------------------------
with tab_calc:
    st.subheader("حاسبة SymPy المباشرة")
    calc_mode = st.radio(
        "اختر العملية الرياضية:",
        ["حل المعادلات", "حساب المشتقة", "حساب التكامل", "معادلات تفاضلية (ODE)"],
        horizontal=True,
    )

    with st.expander("📖 دليل كتابة الرموز الرياضية"):
        st.markdown(
            """
            - **الأسس:** اكتب `x^2` أو `x**2`.
            - **الضرب:** اكتب `2x` أو `2*x`.
            - **الجذور والدوال:** `sqrt(x)`، `sin(x)`، `cos(x)`، `ln(x)`، `exp(x)`.
            - **المعادلات:** استخدم علامة `=` واحدة مثل `x^2 - 5x + 6 = 0`.
            - **المعادلات التفاضلية:** اكتب `y'` أو `y''` أو `y'''` مثل `y'' + 4y = 0`.
            """
        )

    if calc_mode == "حل المعادلات":
        col_eq, col_btn = st.columns([4, 1])
        with col_eq:
            eq_input = st.text_input("اكتب المعادلة المراد حلها:", "x^2 - 5x + 6 = 0")
        with col_btn:
            st.write("")
            st.write("")
            solve_btn = st.button("احسب الحل", key="btn_solve_eq")

        if solve_btn and eq_input:
            res = direct_solve_equation(eq_input)
            if res.success:
                st.success("تم الحل بنجاح:")
                st.latex(res.latex_output)
            else:
                st.error(res.error_message)

    elif calc_mode == "حساب المشتقة":
        col1, col2, col3 = st.columns([3, 1, 1])
        with col1:
            diff_input = st.text_input("التعبير الرياضي:", "x^3 * sin(x)")
        with col2:
            diff_var = st.text_input("بالنسبة للمتغير:", "x")
        with col3:
            diff_order = st.number_input("رتبة الاشتقاق (n):", min_value=1, max_value=10, value=1)

        if st.button("احسب المشتقة", key="btn_diff"):
            res = direct_differentiate(diff_input, var_str=diff_var, order=int(diff_order))
            if res.success:
                st.success("المشتقة:")
                st.latex(f"\\frac{{d^{{{diff_order}}}}}{{d{diff_var}^{{{diff_order}}}}} = {res.latex_output}")
            else:
                st.error(res.error_message)

    elif calc_mode == "حساب التكامل":
        col_expr, col_var = st.columns([3, 1])
        with col_expr:
            int_input = st.text_input("التعبير الرياضي للتكامل:", "2x + cos(x)")
        with col_var:
            int_var = st.text_input("المتغير:", "x")

        is_definite = st.checkbox("تكامل محدد (بحدود)")
        col_a, col_b = st.columns(2)
        lower_b = col_a.text_input("الحد الأدنى:", "0") if is_definite else None
        upper_b = col_b.text_input("الحد الأعلى:", "pi") if is_definite else None

        if st.button("احسب التكامل", key="btn_int"):
            res = direct_integrate(int_input, var_str=int_var, lower_bound=lower_b, upper_bound=upper_b)
            if res.success:
                st.success("ناتج التكامل:")
                st.latex(res.latex_output)
            else:
                st.error(res.error_message)

    elif calc_mode == "معادلات تفاضلية (ODE)":
        ode_input = st.text_input("المعادلة التفاضلية (بصيغة y', y''):", "y'' + 4y = 0")
        if st.button("حل المعادلة التفاضلية", key="btn_ode"):
            res = direct_solve_ode(ode_input)
            if res.success:
                st.success("الحل العام للمعادلة التفاضلية:")
                st.latex(res.latex_output)
            else:
                st.error(res.error_message)

# -------------------------------------------------------------
# TAB 2: FROM IMAGE (MAIN APP)
# -------------------------------------------------------------
with tab_image:
    st.subheader("تحليل وتصحيح خطوات الحل من صورة")

    col_upload, col_preview = st.columns([1, 1])

    with col_upload:
        uploaded_file = st.file_uploader(
            "اختر صورة لحل بخط اليد (PNG, JPG, JPEG, WEBP):",
            type=["png", "jpg", "jpeg", "webp"],
        )
        task_choice = st.radio(
            "اختر المهمة المطلوبة:",
            ["صحّح خطواتي", "حل المسألة بالخطوات"],
            horizontal=True,
        )

    with col_preview:
        image_obj = None
        if uploaded_file is not None:
            image_obj = Image.open(uploaded_file)
            st.image(image_obj, caption="الصورة المرفوعة", use_container_width=True)

    # OCR Trigger
    if uploaded_file is not None and image_obj is not None:
        if st.button("🔍 اقرا الصورة واستخرج الخطوات", type="secondary"):
            with st.spinner("جاري قراءة الخطوات بنموذجي رؤية والتحقق من الرموز..."):
                try:
                    ocr_res = read_image_dual_model(
                        image_obj,
                        settings=settings,
                        groq_client=groq_c,
                        ollama_client=ollama_c,
                    )
                    st.session_state["editable_lines"] = "\n".join(ocr_res.lines)
                    st.session_state["ocr_flags"] = ocr_res.flags
                    st.session_state["ocr_done"] = True
                    st.rerun()
                except Exception as e:
                    logger.error(f"OCR execution failed: {e}")
                    st.error(f"حدث خطأ أثناء قراءة الصورة: {str(e)}")

    # Show Warnings / Flags
    flags = st.session_state.get("ocr_flags", [])
    has_flags = len(flags) > 0

    if has_flags:
        st.warning("⚠️ تنبيهات مطابقة القراءة من الصورة:")
        for flg in flags:
            line_prefix = f"[سطر {flg.line_number}] " if flg.line_number else ""
            st.markdown(f"- **{line_prefix}** {flg.message}")

    # Editable Text Area
    st.markdown("##### نص المسألة والخطوات (سطر لكل خطوة، السطر الأول هو المسألة):")
    edited_text = st.text_area(
        label="خطوات الحل المستخرجة",
        value=st.session_state["editable_lines"],
        height=180,
        help="يمكنك مراجعة وتعديل أي رمز أو إشارة قبل التنفيذ",
        label_visibility="collapsed",
    )
    # Sync edited text into state
    st.session_state["editable_lines"] = edited_text

    # Gate checkbox if flags exist
    user_confirmed = True
    if has_flags and st.session_state["editable_lines"].strip():
        user_confirmed = st.checkbox(
            "راجعت القراءة مع الصورة وأؤكد صحة الخطوات المكتوبة",
            value=False,
            key="chk_confirm_flags",
        )

    can_run = bool(st.session_state["editable_lines"].strip()) and user_confirmed

    run_btn = st.button(
        "🚀 بدء الفحص الرياضي",
        type="primary",
        disabled=not can_run,
    )

    if not user_confirmed and has_flags and st.session_state["editable_lines"].strip():
        st.info("يرجى مراجعة التنبيهات أعلاه وتأكيد المراجعة لتفعيل زر الفحص.")

    # Execute task
    if run_btn and st.session_state["editable_lines"].strip():
        lines = [ln.strip() for ln in st.session_state["editable_lines"].split("\n") if ln.strip()]

        if task_choice == "صحّح خطواتي":
            with st.spinner("جاري فحص كل خطوة رياضياً بواسطة محرك SymPy..."):
                check_res = check_student_steps(
                    lines,
                    settings=settings,
                    client=groq_c if settings.is_groq_ready() else ollama_c,
                )

                if check_res.parse_error_line:
                    st.error(check_res.summary_message)
                elif check_res.success:
                    st.success(f"### 🎉 {check_res.summary_message}")
                    for st_item in check_res.steps:
                        with st.container():
                            st.markdown(f"**خطوة {st_item.step_number}:** `{st_item.raw_text.replace('`', chr(96))}`")
                            if st_item.parsed_expr is not None:
                                st.latex(sp.latex(st_item.parsed_expr))
                            st.markdown('<span class="badge-ok">✅ خطوة صحيحة</span>', unsafe_allow_html=True)
                            st.write("---")
                else:
                    st.error(f"### ⚠️ {check_res.summary_message}")

                    for st_item in check_res.steps:
                        is_first_bad = (st_item.step_number == check_res.first_bad_step)

                        box_class = "step-box step-box-bad" if is_first_bad else "step-box"
                        st.markdown(f'<div class="{box_class}">', unsafe_allow_html=True)
                        st.markdown(f"**خطوة {st_item.step_number}:** `{st_item.raw_text.replace('`', chr(96))}`")

                        if st_item.parsed_expr is not None:
                            st.latex(sp.latex(st_item.parsed_expr))

                        if st_item.status == "ok":
                            st.markdown('<span class="badge-ok">✅ صحيحة</span>', unsafe_allow_html=True)
                        elif st_item.status == "bad" and is_first_bad:
                            st.markdown('<span class="badge-bad">❌ أول خطأ ظهر هنا</span>', unsafe_allow_html=True)
                            if st_item.explanation:
                                st.markdown(f"**الغلطة:** {st_item.explanation.mistake}")
                                st.markdown(f"**القاعدة:** {st_item.explanation.rule}")
                                st.markdown("**الخطوة الصح:**")
                                if st_item.explanation.correct_step_latex:
                                    st.latex(st_item.explanation.correct_step_latex)
                                elif st_item.explanation.correct_step_raw:
                                    st.code(st_item.explanation.correct_step_raw)
                        elif st_item.status == "downstream_ok":
                            st.markdown('<span class="badge-downstream">⚠️ سليمة بس مبنية على الغلط اللي فات</span>', unsafe_allow_html=True)
                        elif st_item.status == "bad":
                            st.markdown('<span class="badge-bad">❌ خطأ إضافي</span>', unsafe_allow_html=True)
                        else:
                            st.markdown('<span class="badge-unknown">⚪ غير قابلة للتحقق</span>', unsafe_allow_html=True)

                        st.markdown('</div>', unsafe_allow_html=True)

        elif task_choice == "حل المسألة بالخطوات":
            problem_text = lines[0]
            with st.spinner("جاري حل المسألة والتحقق من الخطوات وإجراء الفحص الرياضي المزدوج..."):
                solve_res = solve_verified(
                    problem_text,
                    settings=settings,
                    client=groq_c if settings.is_groq_ready() else ollama_c,
                )

                parsed_p = parse_expr_safe(problem_text)
                if parsed_p is not None:
                    st.markdown("### المسألة:")
                    st.latex(sp.latex(parsed_p))
                else:
                    st.markdown(f"### المسألة: `{problem_text}`")

                for st_item in solve_res.steps:
                    st.markdown('<div class="step-box">', unsafe_allow_html=True)
                    st.markdown(f"**خطوة {st_item.index}:** {st_item.explain}")
                    if st_item.parsed_expr is not None:
                        st.latex(sp.latex(st_item.parsed_expr))
                    elif st_item.expr_str:
                        st.code(st_item.expr_str)

                    if st_item.status == "ok":
                        st.markdown('<span class="badge-ok">✅ خطوة متحققة رياضياً</span>', unsafe_allow_html=True)
                    elif st_item.status == "bad":
                        st.markdown(f'<span class="badge-bad">❌ {st_item.note}</span>', unsafe_allow_html=True)
                    elif st_item.status == "skip":
                        st.markdown('<span class="badge-unknown">⚪ توضيح نظري</span>', unsafe_allow_html=True)
                    else:
                        st.markdown(f'<span class="badge-unknown">⚪ {st_item.note}</span>', unsafe_allow_html=True)

                    st.markdown('</div>', unsafe_allow_html=True)

                st.write("---")
                st.markdown("#### الناتج النهائي:")
                parsed_final = parse_expr_safe(solve_res.final_answer)
                if parsed_final is not None:
                    st.latex(sp.latex(parsed_final))
                else:
                    st.code(solve_res.final_answer)

                if solve_res.is_fully_verified:
                    st.success(f"{solve_res.status_summary}")
                else:
                    st.warning(f"{solve_res.status_summary}")

                if solve_res.cross_check_answer:
                    if solve_res.cross_check_matches:
                        st.info(f"🔍 **الفحص المستقل بواسطة SymPy:** {solve_res.cross_check_note}")
                        st.latex(solve_res.cross_check_answer)
                    else:
                        st.warning(f"⚠️ **فحص SymPy المستقل:** {solve_res.cross_check_note}")
                        st.latex(solve_res.cross_check_answer)
