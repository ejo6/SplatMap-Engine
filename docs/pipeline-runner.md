# Pipeline runner (E-01)

`pipeline/run.py` runs the stage scripts for one video. PRD §7.2, FR-09, §9.

```
python pipeline/run.py --youtube-id <id> [--stages S0..S9] [--window a,b] [--force] [--work-root work]
```

- `--stages`: an inclusive range (`S0..S9`) or a comma list (`S2,S8`). A name also matches its substages: `S3` means `S3, S3b`, `S4` means `S4a, S4`, and `S9` means `S9a, S9b`.
- `--force`: re-run the selected stages even if they're done. Stages downstream re-run automatically because their inputs changed.
- The runner itself needs only the standard library, so any Python 3.10+ works.

## Stage table

The table is `STAGES` at the top of `run.py`. **Owners: when you add a stage script, use the name below, or edit the table in your PR.**

| Stage | Script | Env | Depends on | Default error |
|---|---|---|---|---|
| S0 | `s0_ingest.py` | ingest | | download_blocked |
| S1a | `s1_shots.py` | ingest | S0 | no_usable_shot |
| S1b | `s1_director.py` | ingest | S1a | no_usable_shot |
| S2 | `s2_masks.py` | sam3 | S0, S1b | people_failed |
| S3 | `s3_cameras.py` | recon | S0 | reconstruction_failed |
| S3b | `s3b_world.py` | recon | S3 | reconstruction_failed |
| S4a | `s4a_holes.py` | lama | S2, S3b | reconstruction_failed |
| S4 | `s4_background.py` | recon | S2, S3b, S4a | reconstruction_failed |
| S5 | `s5_bounds.py` | recon | S4 | reconstruction_failed |
| S6a | `s6_body.py` | people | S2, S3b | people_failed |
| S6b | `s6_place.py` | people | S6a | people_failed |
| S7a | `s7_identity.py` | ingest | S2 | people_failed |
| S7 | `s7_avatar.py` | lhm | S7a | people_failed |
| S8 | `s8_people_layer.py` | depth | S2, S3b | people_failed |
| S9a | `s9_package.py` | recon | S5, S6b, S7, S8 | internal |
| S9b | `s9_qa.py` | ingest | S9a | qa_rejected |

If a script doesn't exist yet, the run fails at that stage with `internal` and the detail "… not written yet". Use `--stages` to run only the stages that exist.

## Stage script contract

- **Args:** `--work work/<id>` always. S0 also gets `--youtube-id <id>` and `--window a,b` (if given). `--force` is passed when the runner has decided the stage must re-run (it had run before, or the user passed `--force`). On a first run there's no `--force`, so a stage's own "outputs exist" skip still applies to outputs made by a manual run.
- **Outputs:** write under `work/<id>/<S-number>/` (substages share the folder, e.g. S3b writes into `S3/`).
- **Progress:** print JSON lines `{"stage", "pct", "eta"}` to stdout. The runner re-emits them under its own stage name. All other output (logs, library noise) is passed to stderr.
- **Errors:** exit non-zero. To pick a specific §9 error, print `{"error": "video_unavailable", "detail": "..."}` first. Otherwise the stage's default error is used, and the detail is the last 20 output lines (or the exit code if the stage printed nothing, e.g. OOM-killed).
- **Python:** `$ENVS_DIR/<env>/bin/python` (default `/workspace/envs`, see `gpu-setup.md`). If that path doesn't exist, the runner's own Python is used (local dev).

## Skip logic

- After a stage succeeds, `work/<id>/.done/<stage>.json` = `{inputs, finished, seconds}`.
- `inputs` is a hash of the stage's args plus the `finished` time of each stage it depends on. A stage is skipped (`{"stage","pct":100,"skipped":true}`) when its record exists and the hash matches.
- So re-running any stage (or changing `--window`) re-runs everything that depends on it. Editing output files by hand is **not** detected: use `--force`.
- A failed stage deletes its record.

## Output (for the worker, K-08)

stdout is only JSON lines:
- `{"stage":"S4","pct":42,"eta":610}`: progress. Each stage starts at 0 and ends at 100.
- `{"stage":"S4","pct":100,"eta":0,"skipped":true}`: skipped.
- `{"stage":"S4","error":"reconstruction_failed","detail":"..."}`: the last line on failure. The exit code is 1.
