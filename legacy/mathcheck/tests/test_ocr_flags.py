from llm.ocr import build_ocr_flags

def test_disagreement_flag():
    lines1 = [{"t": "2*x + 3 = 7", "unsure": False}]
    lines2 = [{"t": "2*x + 5 = 7", "unsure": False}]
    flags = build_ocr_flags(lines1, lines2, single_reader=False)
    
    assert any(f.flag_type == "disagree" for f in flags)
    disagree_flags = [f for f in flags if f.flag_type == "disagree"]
    assert disagree_flags[0].line_number == 1
    assert "اختلاف" in disagree_flags[0].message

def test_unparsable_line_flag():
    lines1 = [{"t": "2x +++ ??? = 0", "unsure": False}]
    flags = build_ocr_flags(lines1, None, single_reader=True)
    
    assert any(f.flag_type == "unparsable" for f in flags)
    unparsable_flags = [f for f in flags if f.flag_type == "unparsable"]
    assert unparsable_flags[0].line_number == 1
    assert "تعذر تفسير" in unparsable_flags[0].message

def test_single_reader_flag():
    lines1 = [{"t": "x**2 - 4 = 0", "unsure": False}]
    flags = build_ocr_flags(lines1, None, single_reader=True)
    
    assert any(f.flag_type == "single_reader" for f in flags)

def test_line_count_mismatch_flag():
    lines1 = [{"t": "x = 2", "unsure": False}, {"t": "y = 3", "unsure": False}]
    lines2 = [{"t": "x = 2", "unsure": False}]
    flags = build_ocr_flags(lines1, lines2, single_reader=False)
    
    assert any(f.flag_type == "line_count_mismatch" for f in flags)

def test_unsure_flag():
    lines1 = [{"t": "Integral(x, x)", "unsure": True}]
    lines2 = [{"t": "Integral(x, x)", "unsure": False}]
    flags = build_ocr_flags(lines1, lines2, single_reader=False)
    
    assert any(f.flag_type == "unsure" for f in flags)
