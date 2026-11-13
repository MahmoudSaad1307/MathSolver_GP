# MathLens AI Grading Evaluation Report

Generated automatically by `python -m eval.harness --write-docs` using deterministic synthetic handwritten fixtures (`FakeProvider` + OpenCV + SymPy Lark + quality gate).

## Summary Metrics

- **Cases Passed**: 10/10 (100.0%)
- **Quality Gate Precision**: 100.0% (TP=6, FP=0)
- **Quality Gate Recall**: 100.0% (TN=4, FN=0)
- **Average Pipeline Latency**: 329.4 ms
- **Simulated Eval Cost**: $0.000000

## Per-Case Results

| Case                      | Passed |     Score | Error Type    | SymPy            |  Review | Reasons                                                     | Latency (ms) |
| ------------------------- | -----: | --------: | ------------- | ---------------- | ------: | ----------------------------------------------------------- | -----------: |
| `01_clean_correct`        |   PASS | 15.0/15.0 | `none`        | `EQUIVALENT`     | `False` | -                                                           |         2447 |
| `02_equivalent_fraction`  |   PASS | 15.0/15.0 | `none`        | `EQUIVALENT`     | `False` | -                                                           |          120 |
| `03_sign_error`           |   PASS | 12.5/15.0 | `sign`        | `NOT_EQUIVALENT` | `False` | -                                                           |           97 |
| `04_blurry_image`         |   PASS |  0.0/15.0 | `other`       | `UNPARSABLE`     |  `True` | LOW_CONFIDENCE, UNSURE_EVIDENCE_TOKEN, HIGH_ILLEGIBLE_RATIO |           46 |
| `05_blank_page`           |   PASS |  0.0/15.0 | `incomplete`  | `UNPARSABLE`     |  `True` | EMPTY_SUBMISSION                                            |           40 |
| `06_prompt_injection`     |   PASS |  0.0/15.0 | `concept`     | `NOT_EQUIVALENT` |  `True` | INJECTION_ATTEMPT                                           |          101 |
| `07_illegible_scribble`   |   PASS |  0.0/15.0 | `other`       | `UNPARSABLE`     |  `True` | LOW_CONFIDENCE, HIGH_ILLEGIBLE_RATIO                        |           42 |
| `08_unsure_symbol`        |   PASS | 15.0/15.0 | `none`        | `EQUIVALENT`     |  `True` | LOW_CONFIDENCE, UNSURE_EVIDENCE_TOKEN                       |           97 |
| `09_rule_misuse`          |   PASS |  7.5/15.0 | `rule_misuse` | `NOT_EQUIVALENT` | `False` | -                                                           |          214 |
| `10_total_mismatch_guard` |   PASS | 12.5/15.0 | `none`        | `EQUIVALENT`     |  `True` | TOTAL_MISMATCH, STEP_CHECK_MISMATCH                         |           90 |
