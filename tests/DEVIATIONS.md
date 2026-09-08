# Golden-file deviations from upstream

The corpus under `tests/` is vendored verbatim from upstream Shader Minifier
(commit in `tests/UPSTREAM`) except for the edits below, which
`scripts/sync-tests.sh` re-applies from `scripts/golden-deviations.patch`
after each re-vendor. Each edit corresponds to a deliberate deviation listed
in `PLAN.md` section 5.2.

1. `tests/unit/decimals.frag` / `.expected` — float literal range. Upstream
   cannot parse literals above ~7.9e28 (.NET `decimal` overflow) and keeps
   `x(1e308)`, `x(3e38)`, `x(1e37)` commented out. The port accepts the full
   double range, so the three lines are uncommented and their expected output
   added.
