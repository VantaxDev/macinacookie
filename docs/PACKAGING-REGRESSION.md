# Packaging hardening — 2026-11-01

Bounded follow-up to Chrome PR #1; no extension runtime or Firefox changes.

## Reproduction before fix

The new suite reproduced three failures in the original builder:

- Removing an allowlisted source after a good build overwrote the existing ZIP
  with an incomplete one before raising an error.
- Running with `python -O` disabled assert-based manifest permission validation.
- `python -O` also disabled rejection of symlinked source files.

## Fix

Snapshot the explicit allowlist after validating regular non-symlinked files and
source subdirectories. Use explicit exceptions rather than assertions for reviewed
manifest constraints. Build in a same-directory temporary file, finalize and hash
it, then atomically replace the target. Exceptions remove temporary output and
preserve the previous artifact. This is not a guarantee against hostile concurrent
filesystem modifications or power loss; no fsync durability promise is made.

## Verification

- Seven standard-library Python tests: exact allowlist and root manifest; exclusion
  of synthetic private/unrelated files; checksum reporting; byte-for-byte repeat
  builds; missing sources; symlinked files/directories; optimized Python manifest
  checks; injected ZIP-write and replacement failures with cleanup/preservation.
- Existing Node safety suite: 18/18 pass.
- Python syntax compilation, tabnanny and `git diff --check`: pass.
- Generated ZIP retains SHA-256:
  `e40fcb7ad0b1e3a69f5574c56c3c4c56a3c11331b14681a6636c40fee2316422`.
- Chromium tests not rerun: extension bytes and runtime are unchanged. Prior browser
  results are historical, not new test results from this improvement round.

No production dependencies, license changes, merge, deployment or store release.
Original local-only scheduled-work commit and footer PR #2 remain untouched.
