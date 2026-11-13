from __future__ import annotations

from typing import Literal

import numpy as np
import numpy.typing as npt
import pandas as pd
import statsmodels.formula.api as smf
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator
from scipy import stats
from statsmodels.stats.multitest import multipletests

from app.security import require_internal_key

FloatArray = npt.NDArray[np.float64]

router = APIRouter(
    prefix="/v1/stats",
    tags=["stats"],
    dependencies=[Depends(require_internal_key)],
)


class PairedStatsRequest(BaseModel):
    pre_scores: list[float] = Field(min_length=1)
    post_scores: list[float] = Field(min_length=1)
    max_score: float = Field(default=100.0, gt=0.0)
    n_bootstrap: int = Field(default=2000, ge=200, le=10000)
    seed: int = 42

    @model_validator(mode="after")
    def validate_equal_lengths(self) -> PairedStatsRequest:
        if len(self.pre_scores) != len(self.post_scores):
            raise ValueError("pre_scores and post_scores must have equal length")
        return self


class ShapiroResult(BaseModel):
    statistic: float | None
    p_value: float | None
    normal: bool


class TTestResult(BaseModel):
    statistic: float | None
    p_value: float | None
    df: float


class NonParametricResult(BaseModel):
    statistic: float | None
    p_value: float | None


class EffectSizeCiResult(BaseModel):
    estimate: float
    ci_low: float
    ci_high: float


class HakeGainResult(BaseModel):
    mean_gain: float
    per_student_gains: list[float | None]


class PairedStatsResponse(BaseModel):
    n: int
    pre_mean: float
    pre_sd: float
    pre_median: float
    pre_iqr: float
    post_mean: float
    post_sd: float
    post_median: float
    post_iqr: float
    mean_diff: float
    sd_diff: float
    median_diff: float
    shapiro: ShapiroResult
    paired_t: TTestResult
    wilcoxon: NonParametricResult
    cohens_dz: EffectSizeCiResult
    hake_gain: HakeGainResult
    outlier_indices: list[int]
    warnings: list[str]
    recommended_test: Literal["PAIRED_T", "WILCOXON"]
    interpretation_ar: str
    interpretation_en: str


class TwinQuestionOutcomeInput(BaseModel):
    concept_key: str = Field(min_length=1)
    order_index: int = Field(ge=1)
    pre_wrong_post_correct: int = Field(ge=0)
    pre_correct_post_wrong: int = Field(ge=0)
    both_correct: int = Field(default=0, ge=0)
    both_wrong: int = Field(default=0, ge=0)


class ReliabilityPairInput(BaseModel):
    ai_score: float = Field(ge=0.0)
    teacher_score: float = Field(ge=0.0)
    max_score: float = Field(gt=0.0)


class BetweenStatsRequest(BaseModel):
    treatment_pre: list[float] = Field(default_factory=list)
    treatment_post: list[float] = Field(default_factory=list)
    control_pre: list[float] = Field(default_factory=list)
    control_post: list[float] = Field(default_factory=list)
    twin_question_outcomes: list[TwinQuestionOutcomeInput] = Field(default_factory=list)
    reliability_pairs: list[ReliabilityPairInput] = Field(default_factory=list)
    n_bootstrap: int = Field(default=2000, ge=200, le=10000)
    seed: int = 42

    @model_validator(mode="after")
    def validate_equal_lengths(self) -> BetweenStatsRequest:
        if len(self.treatment_pre) != len(self.treatment_post):
            raise ValueError("treatment_pre and treatment_post must have equal length")
        if len(self.control_pre) != len(self.control_post):
            raise ValueError("control_pre and control_post must have equal length")
        return self


class DidResult(BaseModel):
    estimate: float
    se: float
    t_stat: float
    p_value: float
    ci_low: float
    ci_high: float
    clustered_by_student: bool


class GroupComparisonResult(BaseModel):
    treatment_n: int
    control_n: int
    treatment_gain_mean: float
    treatment_gain_sd: float
    control_gain_mean: float
    control_gain_sd: float
    welch_t: TTestResult
    mann_whitney: NonParametricResult
    hedges_g: EffectSizeCiResult
    did: DidResult


class McNemarItemResult(BaseModel):
    concept_key: str
    order_index: int
    b_improved: int
    c_regressed: int
    p_value: float
    p_adjusted_holm: float
    significant: bool


class ReliabilitySummaryResult(BaseModel):
    n: int
    mae: float
    exact_agreement_rate: float
    within_one_agreement_rate: float
    override_rate: float
    cohens_kappa: float
    quadratic_weighted_kappa: float


class BetweenStatsResponse(BaseModel):
    group_comparison: GroupComparisonResult | None
    mcnemar: list[McNemarItemResult]
    reliability: ReliabilitySummaryResult | None
    warnings: list[str]
    interpretation_ar: str
    interpretation_en: str


def _safe_sd(values: FloatArray) -> float:
    return float(np.std(values, ddof=1)) if len(values) >= 2 else 0.0


def _iqr(values: FloatArray) -> float:
    q75, q25 = np.percentile(values, [75.0, 25.0])
    return float(q75 - q25)


def _detect_outlier_indices(diffs: FloatArray) -> list[int]:
    if len(diffs) < 4:
        return []
    q75, q25 = np.percentile(diffs, [75.0, 25.0])
    iqr = float(q75 - q25)
    lower = float(q25) - 1.5 * iqr
    upper = float(q75) + 1.5 * iqr
    if iqr <= 1e-12:
        median = float(np.median(diffs))
        return [int(i) for i, val in enumerate(diffs) if abs(float(val) - median) > 1e-9]
    return [int(i) for i, val in enumerate(diffs) if val < lower or val > upper]


def _cohens_dz_bootstrap(
    diffs: FloatArray,
    *,
    n_bootstrap: int,
    seed: int,
) -> EffectSizeCiResult:
    n = len(diffs)
    if n < 2:
        return EffectSizeCiResult(estimate=0.0, ci_low=0.0, ci_high=0.0)
    sd = float(np.std(diffs, ddof=1))
    if sd <= 1e-12:
        return EffectSizeCiResult(estimate=0.0, ci_low=0.0, ci_high=0.0)
    estimate = float(np.mean(diffs) / sd)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, n, size=(n_bootstrap, n))
    samples = diffs[idx]
    means = np.mean(samples, axis=1)
    sds = np.std(samples, axis=1, ddof=1)
    valid = sds > 1e-12
    if not np.any(valid):
        return EffectSizeCiResult(
            estimate=round(estimate, 6),
            ci_low=round(estimate, 6),
            ci_high=round(estimate, 6),
        )
    dz_boot = means[valid] / sds[valid]
    low, high = np.percentile(dz_boot, [2.5, 97.5])
    return EffectSizeCiResult(
        estimate=round(estimate, 6),
        ci_low=round(float(low), 6),
        ci_high=round(float(high), 6),
    )


def _hedges_g(t_gain: FloatArray, c_gain: FloatArray) -> float:
    n1, n2 = len(t_gain), len(c_gain)
    if n1 < 2 or n2 < 2:
        return 0.0
    s1 = float(np.var(t_gain, ddof=1))
    s2 = float(np.var(c_gain, ddof=1))
    pooled_var = ((n1 - 1) * s1 + (n2 - 1) * s2) / (n1 + n2 - 2)
    pooled_sd = float(np.sqrt(max(pooled_var, 0.0)))
    if pooled_sd <= 1e-12:
        return 0.0
    j = 1.0 - (3.0 / (4.0 * (n1 + n2) - 9.0)) if (n1 + n2) > 3 else 1.0
    return float(j * (float(np.mean(t_gain)) - float(np.mean(c_gain))) / pooled_sd)


def _hedges_g_bootstrap(
    t_gain: FloatArray,
    c_gain: FloatArray,
    *,
    n_bootstrap: int,
    seed: int,
) -> EffectSizeCiResult:
    est = _hedges_g(t_gain, c_gain)
    n1, n2 = len(t_gain), len(c_gain)
    if n1 < 2 or n2 < 2:
        return EffectSizeCiResult(estimate=0.0, ci_low=0.0, ci_high=0.0)
    rng = np.random.default_rng(seed)
    boot_vals = np.empty(n_bootstrap, dtype=float)
    for b in range(n_bootstrap):
        t_sample = t_gain[rng.integers(0, n1, size=n1)]
        c_sample = c_gain[rng.integers(0, n2, size=n2)]
        boot_vals[b] = _hedges_g(t_sample, c_sample)
    low, high = np.percentile(boot_vals, [2.5, 97.5])
    return EffectSizeCiResult(
        estimate=round(est, 6),
        ci_low=round(float(low), 6),
        ci_high=round(float(high), 6),
    )


def _compute_did(
    t_pre: FloatArray,
    t_post: FloatArray,
    c_pre: FloatArray,
    c_post: FloatArray,
) -> DidResult:
    n1, n2 = len(t_pre), len(c_pre)
    rows: list[dict[str, float | int]] = []
    student_id = 0
    for p0, p1 in zip(t_pre, t_post, strict=True):
        rows.append({"score": float(p0), "treat": 1, "post": 0, "student_id": student_id})
        rows.append({"score": float(p1), "treat": 1, "post": 1, "student_id": student_id})
        student_id += 1
    for p0, p1 in zip(c_pre, c_post, strict=True):
        rows.append({"score": float(p0), "treat": 0, "post": 0, "student_id": student_id})
        rows.append({"score": float(p1), "treat": 0, "post": 1, "student_id": student_id})
        student_id += 1

    df = pd.DataFrame(rows)
    model = smf.ols("score ~ treat * post", data=df)
    clustered = False
    if n1 + n2 >= 4:
        try:
            fit = model.fit(cov_type="cluster", cov_kwds={"groups": df["student_id"]})
            clustered = True
        except Exception:
            fit = model.fit()
    else:
        fit = model.fit()

    term = "treat:post"
    est = float(fit.params.get(term, 0.0))
    se = float(fit.bse.get(term, 0.0)) if term in fit.bse else 0.0
    t_val = float(fit.tvalues.get(term, 0.0)) if term in fit.tvalues else 0.0
    p_val = float(fit.pvalues.get(term, 1.0)) if term in fit.pvalues else 1.0
    ci = fit.conf_int()
    if term in ci.index:
        ci_low = float(ci.loc[term, 0])
        ci_high = float(ci.loc[term, 1])
    else:
        ci_low, ci_high = est, est

    if np.isnan(se) or np.isnan(p_val):
        se = 0.0
        t_val = 0.0
        p_val = 1.0
        ci_low, ci_high = est, est

    return DidResult(
        estimate=round(est, 6),
        se=round(se, 6),
        t_stat=round(t_val, 6),
        p_value=round(p_val, 6),
        ci_low=round(ci_low, 6),
        ci_high=round(ci_high, 6),
        clustered_by_student=clustered,
    )


def _compute_reliability(pairs: list[ReliabilityPairInput]) -> ReliabilitySummaryResult | None:
    if not pairs:
        return None
    n = len(pairs)
    ai_vals = np.array([p.ai_score for p in pairs], dtype=float)
    teacher_vals = np.array([p.teacher_score for p in pairs], dtype=float)
    diffs = np.abs(ai_vals - teacher_vals)

    mae = float(np.mean(diffs))
    exact_rate = float(np.mean(diffs <= 1e-6))
    within_one_rate = float(np.mean(diffs <= 1.0 + 1e-6))
    override_rate = float(np.mean(diffs > 1e-6))

    ai_int = np.rint(ai_vals).astype(int)
    teacher_int = np.rint(teacher_vals).astype(int)
    max_label = int(
        max(
            np.max(ai_int),
            np.max(teacher_int),
            int(np.ceil(max(p.max_score for p in pairs))),
        )
    )
    k = max(2, max_label + 1)
    confusion = np.zeros((k, k), dtype=float)
    for a_lbl, t_lbl in zip(ai_int, teacher_int, strict=True):
        a_idx = max(0, min(k - 1, int(a_lbl)))
        t_idx = max(0, min(k - 1, int(t_lbl)))
        confusion[a_idx, t_idx] += 1.0

    hist_a = np.sum(confusion, axis=1)
    hist_t = np.sum(confusion, axis=0)
    expected = np.outer(hist_a, hist_t) / float(n)

    p_o = float(np.trace(confusion) / float(n))
    p_e = float(np.trace(expected) / float(n))
    if abs(1.0 - p_e) <= 1e-12:
        kappa = 1.0 if abs(1.0 - p_o) <= 1e-12 else 0.0
    else:
        kappa = (p_o - p_e) / (1.0 - p_e)

    idx = np.arange(k, dtype=float)
    weights = ((idx[:, None] - idx[None, :]) ** 2) / float((k - 1) ** 2)
    denom = float(np.sum(weights * expected))
    numer = float(np.sum(weights * confusion))
    if denom <= 1e-12:
        qwk = 1.0 if numer <= 1e-12 else 0.0
    else:
        qwk = 1.0 - (numer / denom)

    return ReliabilitySummaryResult(
        n=n,
        mae=round(mae, 6),
        exact_agreement_rate=round(exact_rate, 6),
        within_one_agreement_rate=round(within_one_rate, 6),
        override_rate=round(override_rate, 6),
        cohens_kappa=round(float(kappa), 6),
        quadratic_weighted_kappa=round(float(qwk), 6),
    )


def _describe_effect_ar(d: float) -> str:
    mag = abs(d)
    if mag < 0.2:
        return "ضئيل"
    if mag < 0.5:
        return "صغير"
    if mag < 0.8:
        return "متوسط"
    return "كبير"


def _describe_effect_en(d: float) -> str:
    mag = abs(d)
    if mag < 0.2:
        return "negligible"
    if mag < 0.5:
        return "small"
    if mag < 0.8:
        return "medium"
    return "large"


@router.post("/paired", response_model=PairedStatsResponse)
def compute_paired_stats(body: PairedStatsRequest) -> PairedStatsResponse:
    pre = np.asarray(body.pre_scores, dtype=float)
    post = np.asarray(body.post_scores, dtype=float)
    diffs = post - pre
    n = len(pre)

    shapiro_res = ShapiroResult(statistic=None, p_value=None, normal=False)
    if n >= 3 and float(np.ptp(diffs)) > 1e-12:
        sw = stats.shapiro(diffs)
        p_sw = float(sw.pvalue)
        shapiro_res = ShapiroResult(
            statistic=round(float(sw.statistic), 6),
            p_value=round(p_sw, 6),
            normal=bool(p_sw >= 0.05),
        )

    if n >= 2 and float(np.std(diffs, ddof=1)) > 1e-12:
        t_res = stats.ttest_rel(post, pre)
        paired_t = TTestResult(
            statistic=round(float(t_res.statistic), 6),
            p_value=round(float(t_res.pvalue), 6),
            df=float(n - 1),
        )
    else:
        paired_t = TTestResult(
            statistic=0.0 if n >= 2 else None,
            p_value=1.0 if n >= 2 else None,
            df=float(max(0, n - 1)),
        )

    nonzero = diffs[np.abs(diffs) > 1e-12]
    if len(nonzero) >= 1:
        w_res = stats.wilcoxon(post, pre, zero_method="wilcox", method="auto")
        wilcoxon = NonParametricResult(
            statistic=round(float(w_res.statistic), 6),
            p_value=round(float(w_res.pvalue), 6),
        )
    else:
        wilcoxon = NonParametricResult(
            statistic=0.0 if n >= 2 else None,
            p_value=1.0 if n >= 2 else None,
        )

    dz = _cohens_dz_bootstrap(diffs, n_bootstrap=body.n_bootstrap, seed=body.seed)

    per_gains: list[float | None] = []
    valid_gains: list[float] = []
    for p0, p1 in zip(pre, post, strict=True):
        if body.max_score - float(p0) > 1e-9:
            g_val = (float(p1) - float(p0)) / (body.max_score - float(p0))
            rounded = round(g_val, 6)
            per_gains.append(rounded)
            valid_gains.append(rounded)
        else:
            per_gains.append(None)

    hake = HakeGainResult(
        mean_gain=round(float(np.mean(valid_gains)) if valid_gains else 0.0, 6),
        per_student_gains=per_gains,
    )

    outliers = _detect_outlier_indices(diffs)
    warnings: list[str] = []
    if n < 5:
        warnings.append("VERY_SMALL_SAMPLE")
    elif n < 15:
        warnings.append("SMALL_SAMPLE")
    if not shapiro_res.normal and n >= 3:
        warnings.append("NON_NORMAL_DISTRIBUTION")
    if outliers:
        warnings.append("POTENTIAL_OUTLIERS")
    if float(np.ptp(diffs)) <= 1e-12:
        warnings.append("ZERO_VARIANCE")

    recommended: Literal["PAIRED_T", "WILCOXON"] = (
        "PAIRED_T" if shapiro_res.normal and n >= 15 else "WILCOXON"
    )
    primary_p = paired_t.p_value if recommended == "PAIRED_T" else wilcoxon.p_value
    sig_ar = (
        "دال إحصائياً" if primary_p is not None and primary_p < 0.05 else "غير دال إحصائياً"
    )
    sig_en = (
        "statistically significant"
        if primary_p is not None and primary_p < 0.05
        else "not statistically significant"
    )
    mean_diff = float(np.mean(diffs))
    p_text = f"{primary_p:.4f}" if primary_p is not None else "N/A"

    interp_ar = (
        f"العينة تضم {n} طالبًا، بمتوسط تحسن {mean_diff:+.2f}. "
        f"النتيجة ({recommended}) {sig_ar} (p = {p_text})، "
        f"وحجم الأثر Cohen's dz = {dz.estimate:.2f} ({_describe_effect_ar(dz.estimate)})، "
        f"ومكسب هايك المعياري <g> = {hake.mean_gain:.2f}."
    )
    interp_en = (
        f"Sample of {n} students shows a mean difference of {mean_diff:+.2f}. "
        f"The recommended test ({recommended}) is {sig_en} (p = {p_text}), "
        f"Cohen's dz = {dz.estimate:.2f} ({_describe_effect_en(dz.estimate)} effect), "
        f"and mean Hake normalized gain <g> = {hake.mean_gain:.2f}."
    )

    return PairedStatsResponse(
        n=n,
        pre_mean=round(float(np.mean(pre)), 6),
        pre_sd=round(_safe_sd(pre), 6),
        pre_median=round(float(np.median(pre)), 6),
        pre_iqr=round(_iqr(pre), 6),
        post_mean=round(float(np.mean(post)), 6),
        post_sd=round(_safe_sd(post), 6),
        post_median=round(float(np.median(post)), 6),
        post_iqr=round(_iqr(post), 6),
        mean_diff=round(mean_diff, 6),
        sd_diff=round(_safe_sd(diffs), 6),
        median_diff=round(float(np.median(diffs)), 6),
        shapiro=shapiro_res,
        paired_t=paired_t,
        wilcoxon=wilcoxon,
        cohens_dz=dz,
        hake_gain=hake,
        outlier_indices=outliers,
        warnings=warnings,
        recommended_test=recommended,
        interpretation_ar=interp_ar,
        interpretation_en=interp_en,
    )


@router.post("/between", response_model=BetweenStatsResponse)
def compute_between_stats(body: BetweenStatsRequest) -> BetweenStatsResponse:
    warnings: list[str] = []
    group_comparison: GroupComparisonResult | None = None

    t_pre = np.asarray(body.treatment_pre, dtype=float)
    t_post = np.asarray(body.treatment_post, dtype=float)
    c_pre = np.asarray(body.control_pre, dtype=float)
    c_post = np.asarray(body.control_post, dtype=float)

    n_t = len(t_pre)
    n_c = len(c_pre)

    if n_t >= 2 and n_c >= 2:
        t_gain = t_post - t_pre
        c_gain = c_post - c_pre

        s1_sq = float(np.var(t_gain, ddof=1))
        s2_sq = float(np.var(c_gain, ddof=1))
        if s1_sq <= 1e-12 and s2_sq <= 1e-12:
            mean_delta = float(np.mean(t_gain) - np.mean(c_gain))
            welch = TTestResult(
                statistic=0.0 if abs(mean_delta) <= 1e-12 else float("inf"),
                p_value=1.0 if abs(mean_delta) <= 1e-12 else 0.0,
                df=float(n_t + n_c - 2),
            )
        else:
            w_res = stats.ttest_ind(t_gain, c_gain, equal_var=False)
            v1 = s1_sq / n_t
            v2 = s2_sq / n_c
            denom_df = ((v1**2) / (n_t - 1)) + ((v2**2) / (n_c - 1))
            df_w = ((v1 + v2) ** 2) / denom_df if denom_df > 1e-12 else float(n_t + n_c - 2)
            welch = TTestResult(
                statistic=round(float(w_res.statistic), 6),
                p_value=round(float(w_res.pvalue), 6),
                df=round(float(df_w), 4),
            )

        mw_res = stats.mannwhitneyu(t_gain, c_gain, alternative="two-sided")
        mann_whitney = NonParametricResult(
            statistic=round(float(mw_res.statistic), 6),
            p_value=round(float(mw_res.pvalue), 6),
        )

        hedges = _hedges_g_bootstrap(
            t_gain,
            c_gain,
            n_bootstrap=body.n_bootstrap,
            seed=body.seed,
        )
        did = _compute_did(t_pre, t_post, c_pre, c_post)

        group_comparison = GroupComparisonResult(
            treatment_n=n_t,
            control_n=n_c,
            treatment_gain_mean=round(float(np.mean(t_gain)), 6),
            treatment_gain_sd=round(_safe_sd(t_gain), 6),
            control_gain_mean=round(float(np.mean(c_gain)), 6),
            control_gain_sd=round(_safe_sd(c_gain), 6),
            welch_t=welch,
            mann_whitney=mann_whitney,
            hedges_g=hedges,
            did=did,
        )

        if n_t < 15 or n_c < 15:
            warnings.append("SMALL_GROUP_SAMPLE")
        if max(n_t, n_c) > 2 * min(n_t, n_c):
            warnings.append("UNBALANCED_GROUPS")
    elif (n_t > 0) or (n_c > 0):
        warnings.append("INSUFFICIENT_GROUPS_FOR_BETWEEN_COMPARISON")

    mcnemar_results: list[McNemarItemResult] = []
    if body.twin_question_outcomes:
        raw_pvals: list[float] = []
        for item in body.twin_question_outcomes:
            b = item.pre_wrong_post_correct
            c = item.pre_correct_post_wrong
            total_discordant = b + c
            if total_discordant > 0:
                p_raw = float(
                    stats.binomtest(
                        min(b, c),
                        n=total_discordant,
                        p=0.5,
                        alternative="two-sided",
                    ).pvalue
                )
            else:
                p_raw = 1.0
            raw_pvals.append(p_raw)

        reject, p_adj, _, _ = multipletests(raw_pvals, alpha=0.05, method="holm")
        for idx_q, item in enumerate(body.twin_question_outcomes):
            mcnemar_results.append(
                McNemarItemResult(
                    concept_key=item.concept_key,
                    order_index=item.order_index,
                    b_improved=item.pre_wrong_post_correct,
                    c_regressed=item.pre_correct_post_wrong,
                    p_value=round(float(raw_pvals[idx_q]), 6),
                    p_adjusted_holm=round(float(p_adj[idx_q]), 6),
                    significant=bool(reject[idx_q]),
                )
            )

    reliability = _compute_reliability(body.reliability_pairs)

    if group_comparison is not None:
        did = group_comparison.did
        sig_ar = "دال إحصائياً" if did.p_value < 0.05 else "غير دال إحصائياً"
        sig_en = (
            "statistically significant"
            if did.p_value < 0.05
            else "not statistically significant"
        )
        interp_ar = (
            f"مقارنة مجموعة الفيديو (n={n_t}) بالمجموعة الضابطة (n={n_c}): "
            f"أثر الفرق في الفروق DiD = {did.estimate:+.2f} (p = {did.p_value:.4f}، {sig_ar})، "
            f"وحجم الأثر Hedges' g = {group_comparison.hedges_g.estimate:.2f}."
        )
        interp_en = (
            f"Comparing video group (n={n_t}) vs control group (n={n_c}): "
            f"Difference-in-Differences = {did.estimate:+.2f} (p = {did.p_value:.4f}, {sig_en}), "
            f"Hedges' g = {group_comparison.hedges_g.estimate:.2f}."
        )
    else:
        interp_ar = (
            "لا تتوفر مجموعتان مكتملتان بعد لإجراء مقارنة بين "
            "مجموعة الفيديو والمجموعة الضابطة."
        )
        interp_en = (
            "Two complete groups are not yet available for "
            "between-group treatment vs control testing."
        )

    return BetweenStatsResponse(
        group_comparison=group_comparison,
        mcnemar=mcnemar_results,
        reliability=reliability,
        warnings=warnings,
        interpretation_ar=interp_ar,
        interpretation_en=interp_en,
    )
