# Baseline vs. hybrid eval (Phase 4)

Model: `gpt-4o-mini` · Temperature: 0.7 · Date: 2026-09-26 · n per persona: 3

**Deviation from spec:** the hybrid path reuses the cached meal pool (`generate.load_cached("data/meals.json")`) instead of calling fresh `generate_meals` per run. Fresh generation is a second, uncached LLM call per run (9 more calls, more cost and wall time) that mostly reproduces the same pool this cache already holds; reusing it keeps the eval cheap and fast while `solve()` is still exercised fresh every run. State this if the numbers are quoted.

## Summary

| Method | runs | % over budget | % ineligible charged to SNAP | % all slots covered | mean sufficiency violations | nutrition targets met (of 5) | % all nutrition targets met | mean time (ms) |
|---|---|---|---|---|---|---|---|---|
| Baseline (plain LLM) | 9 | 0% | 0% | 100% | 5.6 | 2.8 / 5 | 11% | 4005 |
| Hybrid (generate + solve) | 9 | 0% | 0% | 100% | 0.0 | 4.0 / 5 | 0% | 56 |

Parse/solve failures: baseline 0/9, hybrid 0/9.

Notes: percentages are over all attempted runs (a failed run counts as not-over-budget, not-ineligible, slots-not-covered, targets-not-met, since its true value is unknown). Mean sufficiency violations is averaged over successful runs only. Ingredient-sufficiency counts an ingredient as satisfied if packages bought (plus one full package for staples, matching solve.py's assume_staples default) cover the grams the plan's meals need.

## Per persona

| Persona | Method | runs | % over budget | % ineligible charged to SNAP | % all slots covered | mean sufficiency violations | nutrition targets met (of 5) | % all nutrition targets met | mean time (ms) |
|---|---|---|---|---|---|---|---|---|---|
| P1 typical | Baseline | 3 | 0% | 0% | 100% | 9.0 | 2.7 / 5 | 0% | 5403 |
| P1 typical | Hybrid | 3 | 0% | 0% | 100% | 0.0 | 4.0 / 5 | 0% | 91 |
| P2 microwave-only, tight | Baseline | 3 | 0% | 0% | 100% | 0.3 | 3.0 / 5 | 33% | 2831 |
| P2 microwave-only, tight | Hybrid | 3 | 0% | 0% | 100% | 0.0 | 4.0 / 5 | 0% | 30 |
| P3 vegetarian family | Baseline | 3 | 0% | 0% | 100% | 7.3 | 2.7 / 5 | 0% | 3781 |
| P3 vegetarian family | Hybrid | 3 | 0% | 0% | 100% | 0.0 | 4.0 / 5 | 0% | 47 |

## Raw per-run rows

| Method | Persona | Run | Basket | EBT | Cash | Over budget | Ineligible on SNAP | Slots covered | Suff. violations | Targets met (of 5) | All targets met | Error |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Baseline | P1 typical | 0 | $46.30 | $46.30 | $0.00 | False | False | True | 12 | 3 | False |  |
| Baseline | P1 typical | 1 | $31.07 | $31.07 | $0.00 | False | False | True | 1 | 2 | False |  |
| Baseline | P1 typical | 2 | $29.52 | $29.52 | $0.00 | False | False | True | 14 | 3 | False |  |
| Baseline | P2 microwave-only, tight | 0 | $27.43 | $27.43 | $0.00 | False | False | True | 0 | 2 | False |  |
| Baseline | P2 microwave-only, tight | 1 | $21.36 | $21.36 | $0.00 | False | False | True | 1 | 5 | True |  |
| Baseline | P2 microwave-only, tight | 2 | $13.64 | $13.64 | $0.00 | False | False | True | 0 | 2 | False |  |
| Baseline | P3 vegetarian family | 0 | $35.29 | $35.29 | $0.00 | False | False | True | 11 | 3 | False |  |
| Baseline | P3 vegetarian family | 1 | $30.72 | $30.72 | $0.00 | False | False | True | 0 | 2 | False |  |
| Baseline | P3 vegetarian family | 2 | $26.29 | $26.29 | $0.00 | False | False | True | 11 | 3 | False |  |
| Hybrid | P1 typical | 0 | $56.97 | $56.97 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P1 typical | 1 | $56.97 | $56.97 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P1 typical | 2 | $56.97 | $56.97 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P2 microwave-only, tight | 0 | $38.08 | $38.08 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P2 microwave-only, tight | 1 | $38.08 | $38.08 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P2 microwave-only, tight | 2 | $38.08 | $38.08 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P3 vegetarian family | 0 | $101.21 | $101.21 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P3 vegetarian family | 1 | $101.21 | $101.21 | $0.00 | False | False | True | 0 | 4 | False |  |
| Hybrid | P3 vegetarian family | 2 | $101.21 | $101.21 | $0.00 | False | False | True | 0 | 4 | False |  |

