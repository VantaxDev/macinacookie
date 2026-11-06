# Synthetic test workflows

No production dependency installation is required. Use existing Node.js 18+ and
Python 3. Real browser checks additionally require matching Chromium/ChromeDriver;
the CDP worker helper needs a Node runtime with built-in WebSocket. If needed set
`MACINACOOKIE_CDP_NODE` to an existing supported Node binary; no runtime is installed
by these scripts.

Run from the repository root:

```sh
node --test tests/logic.test.js tests/consent.test.js tests/worker-preview.test.js
node tests/qa-regressions.js
python3 tests/driver_cleanup_test.py
python3 -m unittest discover -s tests -p build_test.py -v
python3 scripts/build.py
python3 -m unittest discover -s tests -p license_test.py -v
```

The builder prints a SHA-256 digest for the deterministic extension-only ZIP.
Profiles, archives, logs and screenshots are local artifacts excluded from Git.
Never substitute a personal browser profile or real cookies for the fixture data.

## Browser and package checks

```sh
python3 tests/chromium.py
python3 tests/lifecycle.py dist/macinacookie-chrome-1.2.0.zip \
  --sha256 <digest-printed-by-build> --output dist/lifecycle-new-run
python3 tests/worker_lifecycle.py dist/macinacookie-chrome-1.2.0.zip \
  --sha256 <digest-printed-by-build> --output dist/worker-new-run
python3 tests/confirmation_recovery.py dist/macinacookie-chrome-1.2.0.zip \
  --sha256 <digest-printed-by-build> --output dist/confirmation-new-run
```

Both package harnesses verify SHA, CRC, exact allowlist and source-byte identity
before extracting into a disposable directory. Existing output is refused.
All browser cookies/sites/profiles are synthetic. Browser navigations are extension
pages, not external fixture sites. The shared Driver cleans up partially acquired
resources; its error paths are tested with pure mocks, not OS failure injection.

The restart harness reuses each disposable profile across full browser lifetimes.
Its predecessor changes only manifest.version, not historical runtime code: this
is unpacked synthetic migration coverage, NOT real CRX/Store delivery.

The worker harness stops only the owned extension worker via CDP. It observes a
stopped version and missing worker target, then observes a new execution context
before diagnostics. Popup navigation intentionally wakes the worker; alarm/cookie
paths do not send a product status request before observing wake. Target IDs can
be reused, so they are not the sole instance-identity oracle. An observation grant
never automatically authorizes cleanup; a separate positive control deliberately
deletes only its own eligible synthetic cookie after saving automatic rules.

The prior-worker preview token must be rejected after stop, while a fresh preview
remains usable. Pure VM regressions also cover stale-token replay, consent/revoke
races and failed persistence. Mock dispatch assertions are distinct from browser
UI/storage/cookie observations; neither proves real OS process cleanup or cancels
API operations already dispatched to Chrome.

Not established by these checks: branded Google Chrome, minimum Chrome 130,
Windows/macOS, long OS suspension, actual Store delivery, or legal/security/Store
certification.

## Retained confirmation dialog recovery

The focused `confirmation_recovery.py` acceptance keeps the real dashboard and its
confirmation dialog in the original tab while CDP stops only its extension worker.
A separate popup tab wakes the worker; its target is observed before worker
inspection, and a new execution context is then required. The popup status request
is the intended wake source. Switching back must retain the original document/dialog: a native click
on the old confirmation must announce an actionable expiry error, clear stale
selection, preserve the synthetic cookie and focus the enabled preview button.
A fresh UI preview must then support cancel without deletion and one successful
synthetic deletion. Automatic cleanup remains unauthorized throughout.

This fills the retained-dialog path absent from the API-only worker replay test.
It checks DOM alert/status roles and focus, not spoken output with real screen
reader software or exhaustive cross-tab interleavings. The harness saves two real
synthetic UI screenshots, not retouched images or independent pixel approval. The harness creates a temporary launcher that disables GPU/egress;
no system configuration, dependency or server is installed. Use the same existing
WebSocket-capable Node selection as the worker harness. Existing output is refused.
