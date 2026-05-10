# tool-hash-scorecard

Generated: 2026-05-10
Baseline: 1-raw-text2cypher-baseline
Status: improved

## Lanes

| Lane | Dataset | Kind | Pass Rate | Executable Rate | Repair Rate | Failed | Diagnostics |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1-raw-text2cypher-baseline | tool-hash-smoke | raw | 33.3% | 0.0% | 66.7% | 2 | 3 |
| 2-fixture-model | tool-hash-smoke | mixed | 100.0% | 33.3% | 66.7% | 0 | 4 |

## Top Diagnostics

- raw-identifier-quoted: 3
- missing-limit: 1
- no-cypher-output: 1
- relationship-direction-mismatch: 1
- undefined-variable: 1

## Rankings

- Pass rate: 2-fixture-model, 1-raw-text2cypher-baseline
- Executable rate: 2-fixture-model, 1-raw-text2cypher-baseline
- Repair rate: 1-raw-text2cypher-baseline, 2-fixture-model
