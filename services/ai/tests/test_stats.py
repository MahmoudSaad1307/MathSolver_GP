from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient
from scipy import stats
from statsmodels.stats.multitest import multipletests

from app.config import get_settings
from app.main import create_app


def _auth_headers() -> dict[str, str]:
    settings = get_settings()
    return {"X-Internal-Key": settings.ai_internal_key}


def test_stats_endpoints_require_internal_key() -> None:
    get_settings.cache_clear()
    client = TestClient(create_app())
    r1 = client.post("/v1/stats/paired", json={"pre_scores": [50, 60], "post_scores": [70, 80]})
    r2 = client.post("/v1/stats/between", json={})
    assert r1.status_code == 401
    assert r2.status_code == 401


def test_paired_stats_matches_scipy_and_detects_outliers_and_small_samples() -> None:
    get_settings.cache_clear()
    client = TestClient(create_app())
    headers = _auth_headers()

    pre = [
        40.0, 45.0, 50.0, 52.0, 48.0, 55.0, 42.0, 49.0,
        51.0, 47.0, 53.0, 46.0, 44.0, 50.0, 48.0, 46.0,
    ]
    post = [
        70.0, 74.0, 80.0, 81.0, 77.0, 85.0, 72.0, 78.0,
        79.0, 76.0, 83.0, 75.0, 71.0, 78.0, 76.0, 74.0,
    ]
    res = client.post(
        "/v1/stats/paired",
        headers=headers,
        json={
            "pre_scores": pre,
            "post_scores": post,
            "max_score": 100.0,
            "n_bootstrap": 500,
            "seed": 7,
        },
    )
    assert res.status_code == 200
    body = res.json()

    diffs = np.asarray(post) - np.asarray(pre)
    t_expected = stats.ttest_rel(post, pre)
    sw_expected = stats.shapiro(diffs)
    w_expected = stats.wilcoxon(post, pre, zero_method="wilcox")

    assert body["n"] == 16
    assert abs(body["mean_diff"] - float(np.mean(diffs))) < 1e-4
    assert abs(body["paired_t"]["statistic"] - float(t_expected.statistic)) < 1e-4
    assert abs(body["paired_t"]["p_value"] - float(t_expected.pvalue)) < 1e-5
    assert body["paired_t"]["df"] == 15.0
    assert abs(body["shapiro"]["p_value"] - float(sw_expected.pvalue)) < 1e-4
    assert abs(body["wilcoxon"]["statistic"] - float(w_expected.statistic)) < 1e-4

    dz = body["cohens_dz"]
    assert dz["ci_low"] <= dz["estimate"] <= dz["ci_high"]
    assert dz["estimate"] > 1.0
    assert body["hake_gain"]["mean_gain"] > 0.5
    assert "Cohen's dz" in body["interpretation_en"]
    assert "Cohen's dz" in body["interpretation_ar"]

    # Small sample with an outlier and max pre-score edge case
    outlier_res = client.post(
        "/v1/stats/paired",
        headers=headers,
        json={
            "pre_scores": [50.0, 50.0, 50.0, 50.0, 100.0, 50.0],
            "post_scores": [60.0, 61.0, 59.0, 60.0, 100.0, 99.0],
            "max_score": 100.0,
            "n_bootstrap": 300,
        },
    )
    assert outlier_res.status_code == 200
    outlier_body = outlier_res.json()
    assert "SMALL_SAMPLE" in outlier_body["warnings"]
    assert "POTENTIAL_OUTLIERS" in outlier_body["warnings"]
    assert 5 in outlier_body["outlier_indices"]
    assert outlier_body["recommended_test"] == "WILCOXON"
    assert outlier_body["hake_gain"]["per_student_gains"][4] is None

    # Zero-variance diffs and single-point validation
    zero_res = client.post(
        "/v1/stats/paired",
        headers=headers,
        json={"pre_scores": [40.0, 50.0, 60.0], "post_scores": [50.0, 60.0, 70.0]},
    )
    assert zero_res.status_code == 200
    zero_body = zero_res.json()
    assert "VERY_SMALL_SAMPLE" in zero_body["warnings"]
    assert "ZERO_VARIANCE" in zero_body["warnings"]
    assert zero_body["cohens_dz"]["estimate"] == 0.0

    bad = client.post(
        "/v1/stats/paired",
        headers=headers,
        json={"pre_scores": [10.0, 20.0], "post_scores": [30.0]},
    )
    assert bad.status_code == 422


def test_between_stats_did_mcnemar_holm_and_reliability() -> None:
    get_settings.cache_clear()
    client = TestClient(create_app())
    headers = _auth_headers()

    t_pre = [40.0, 42.0, 45.0, 48.0, 50.0, 44.0, 46.0, 49.0]
    t_post = [75.0, 78.0, 82.0, 85.0, 84.0, 79.0, 83.0, 86.0]
    c_pre = [41.0, 44.0, 46.0, 47.0, 51.0, 43.0]
    c_post = [46.0, 48.0, 50.0, 53.0, 54.0, 47.0]

    res = client.post(
        "/v1/stats/between",
        headers=headers,
        json={
            "treatment_pre": t_pre,
            "treatment_post": t_post,
            "control_pre": c_pre,
            "control_post": c_post,
            "twin_question_outcomes": [
                {
                    "concept_key": "log-diff",
                    "order_index": 1,
                    "pre_wrong_post_correct": 12,
                    "pre_correct_post_wrong": 1,
                    "both_correct": 5,
                    "both_wrong": 2,
                },
                {
                    "concept_key": "chain-rule",
                    "order_index": 2,
                    "pre_wrong_post_correct": 3,
                    "pre_correct_post_wrong": 2,
                    "both_correct": 10,
                    "both_wrong": 5,
                },
                {
                    "concept_key": "limits",
                    "order_index": 3,
                    "pre_wrong_post_correct": 0,
                    "pre_correct_post_wrong": 0,
                    "both_correct": 15,
                    "both_wrong": 5,
                },
            ],
            "reliability_pairs": [
                {"ai_score": 4.0, "teacher_score": 4.0, "max_score": 4.0},
                {"ai_score": 3.0, "teacher_score": 2.0, "max_score": 4.0},
                {"ai_score": 1.0, "teacher_score": 1.0, "max_score": 4.0},
                {"ai_score": 0.0, "teacher_score": 0.0, "max_score": 4.0},
                {"ai_score": 2.0, "teacher_score": 2.0, "max_score": 4.0},
            ],
            "n_bootstrap": 400,
            "seed": 11,
        },
    )
    assert res.status_code == 200
    data = res.json()

    gc = data["group_comparison"]
    assert gc is not None
    assert gc["treatment_n"] == 8
    assert gc["control_n"] == 6

    t_gain = np.asarray(t_post) - np.asarray(t_pre)
    c_gain = np.asarray(c_post) - np.asarray(c_pre)
    welch_expected = stats.ttest_ind(t_gain, c_gain, equal_var=False)
    mw_expected = stats.mannwhitneyu(t_gain, c_gain, alternative="two-sided")

    assert abs(gc["welch_t"]["statistic"] - float(welch_expected.statistic)) < 1e-4
    assert abs(gc["welch_t"]["p_value"] - float(welch_expected.pvalue)) < 1e-5
    assert abs(gc["mann_whitney"]["statistic"] - float(mw_expected.statistic)) < 1e-4

    expected_did = float(np.mean(t_gain) - np.mean(c_gain))
    assert abs(gc["did"]["estimate"] - expected_did) < 1e-4
    assert gc["did"]["clustered_by_student"] is True
    assert gc["did"]["ci_low"] < gc["did"]["estimate"] < gc["did"]["ci_high"]
    assert gc["hedges_g"]["ci_low"] <= gc["hedges_g"]["estimate"] <= gc["hedges_g"]["ci_high"]

    # McNemar exact + Holm adjustment
    p1 = float(stats.binomtest(1, n=13, p=0.5, alternative="two-sided").pvalue)
    p2 = float(stats.binomtest(2, n=5, p=0.5, alternative="two-sided").pvalue)
    p3 = 1.0
    _, expected_adj, _, _ = multipletests([p1, p2, p3], alpha=0.05, method="holm")

    assert abs(data["mcnemar"][0]["p_value"] - p1) < 1e-4
    assert abs(data["mcnemar"][0]["p_adjusted_holm"] - float(expected_adj[0])) < 1e-4
    assert data["mcnemar"][0]["significant"] is True
    assert data["mcnemar"][1]["significant"] is False
    assert data["mcnemar"][2]["p_value"] == 1.0

    # Reliability metrics
    rel = data["reliability"]
    assert rel["n"] == 5
    assert abs(rel["mae"] - 0.2) < 1e-5
    assert abs(rel["exact_agreement_rate"] - 0.8) < 1e-5
    assert abs(rel["within_one_agreement_rate"] - 1.0) < 1e-5
    assert abs(rel["override_rate"] - 0.2) < 1e-5
    assert 0.7 < rel["cohens_kappa"] < 0.9
    assert rel["quadratic_weighted_kappa"] > 0.85

    # Only-one-group fallback
    single = client.post(
        "/v1/stats/between",
        headers=headers,
        json={"treatment_pre": [40.0, 50.0], "treatment_post": [60.0, 70.0]},
    )
    assert single.status_code == 200
    assert single.json()["group_comparison"] is None
    assert "INSUFFICIENT_GROUPS_FOR_BETWEEN_COMPARISON" in single.json()["warnings"]
