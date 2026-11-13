from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from eval.harness import format_evaluation_markdown, run_eval_harness


def main() -> int:
    parser = argparse.ArgumentParser(description="Run MathLens AI grading evaluation harness")
    parser.add_argument(
        "--provider",
        choices=["fake"],
        default="fake",
        help="Deterministic evaluation provider (CI defaults to fake)",
    )
    parser.add_argument(
        "--output-md",
        type=Path,
        default=None,
        help="Optional Markdown output path for evaluation report",
    )
    parser.add_argument(
        "--check-regression",
        action="store_true",
        help="Fail with non-zero exit code if pass_rate or quality gate metrics drop below 100%%",
    )
    args = parser.parse_args()

    summary = asyncio.run(run_eval_harness())
    markdown = format_evaluation_markdown(summary)
    if args.output_md is not None:
        args.output_md.resolve().write_text(markdown, encoding="utf-8")

    print(markdown)
    if args.check_regression and (
        summary.pass_rate < 1.0 or summary.gate_precision < 1.0 or summary.gate_recall < 1.0
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
