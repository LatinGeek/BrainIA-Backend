# Laya calibration report

Calibration was run against 240 recent production events from `raw_events` joined to `classified_events`. The run called the locally hosted Laya service through its authenticated `/v1/systemone` endpoint and did not write labels or mutate production data.

## Results

- Evaluated events: 240/240
- Agreement with existing `classified_events.inferred_kind`: 90%
- Best probability temperature from the held-out-free diagnostic sweep: 2.9
- Mean negative log loss before temperature scaling: 0.9735
- Mean negative log loss after temperature scaling: 0.4927
- Predicted classes: notification 210, email 21, expense 6, transfer 2, other 1

## Interpretation

The labels used here are existing classifier outputs, not human-confirmed ground truth. The sample is dominated by notifications, while the historical correction table contains merchant corrections but no confirmed `inferredKind` corrections. The 90% agreement therefore measures consistency with the current classifier, not production correctness. The strong temperature improvement should be treated as a diagnostic only until a human-confirmed, class-balanced holdout exists.

## Decision

Keep Laya in `shadow` mode. Do not enable automatic class activation yet. Capture explicit kind corrections from the app, build a class-balanced holdout, rerun this calibration, and only then consider promoting individual classes behind a feature flag.
