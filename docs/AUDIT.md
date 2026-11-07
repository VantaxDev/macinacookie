# Chrome port audit — 2026-10-31

## Provenance and archive handling

- Received archive: `macinacookie-sorgenti-1.0.1.zip` (61,997 bytes).
- SHA-256: `6bed3ffb97d9821e435341416dd7f42a68f0c47b7106350e7f823304ca7b3df2`.
- Despite the outer filename, the manifest and nested distributable contain **1.1.0**.
- Before isolated extraction: every member checked for absolute paths, traversal,
  backslash paths and symbolic links; expanded size bounded to 10 MB.
- Embedded `macinacookie-1.1.0.zip` contents match the extracted Firefox source byte-for-byte.
- Original ZIP preserved outside this repository. Original source and docs imported in
  baseline commit `1531ad9`, and retained unchanged under `upstream/` / `docs/upstream/`.

## Architecture and changes

No production dependencies or downloaded executable code. `core.js` is pure logic;
`background.js` owns the serialized operation queue, durable ledger, session preview,
permission checks, cookie events, alarm scheduling and deletion checks.
Popup and dashboard communicate only through validated extension messages.

Chrome changes:

1. MV3 service worker loads local scripts synchronously using `importScripts`.
2. Chrome Promise APIs; callback/`return true` message bridge for older Chrome releases.
3. Remove Firefox-only `contextualIdentities`, Gecko metadata, container discovery and
   `firstPartyDomain` API selectors. A nonempty Firefox first-party domain fails closed.
4. Query the current ordinary cookie store with `partitionKey: {}` to include CHIPS.
   Preserve `topLevelSite` and `hasCrossSiteAncestor` for identity, lookup and removal.
   Ordinary Chrome store ID `0` is accepted; other IDs fail closed.
5. Chrome desktop-only platform detection, PNG manifest icons from the original SVG,
   Chrome wording; original Firefox implementation preserved separately.
6. Explicit CSP `script-src 'self'; object-src 'none'; connect-src 'none'`.

## License and secrets review

No explicit source license file or third-party code/dependency found. Ownership was
asserted by the commissioning owner; no license choice was invented. License selection
remains an owner decision before advertising the project as open source.

Reviewed every extension script, manifest, HTML and CSS, and original docs. A targeted
credential-pattern scan found only generated preview tokens and their use, not embedded
credentials/private keys. No telemetry, remote imports, analytics endpoints, content scripts,
`eval`, external scripts or executable network content found. Build uses a file allowlist;
credentials, profiles, original archives and generated packages are excluded from Git.
This is a focused source review, not a third-party penetration test or store approval.

## Permission and behavior review

Only `cookies`, `storage`, `alarms` plus HTTP/HTTPS host access. No `tabs`, history,
webRequest, scripting, downloads, identity, or contextual-identities permission.
All-site host access is needed for the requested global cleanup. Incognito is forbidden.
No network requests are made; a real-browser negative test confirms CSP blocks fetch.

Defaults: 30 observed days; automatic cleanup OFF. Preview expires after 10 minutes,
invalidates when settings change, and is consumed before deletion. Excluded domains include
subdomains. Incomplete scans, missing permissions, unsafe paths, unknown partition fields,
changed fingerprints, recreated cookies and untrusted messages stop or skip deletion.
Each successful deletion is checkpointed; a storage failure stops the batch.

Stored data: identities (domain/name/path/store/partition), first-seen times, SHA-256
fingerprints and aggregate cleanup counts. Raw values are never persisted or displayed.
SHA-256 fingerprints are not encryption: local records remain sensitive navigation metadata.

## Verification actually performed

- **18 / 18 Node.js safety/logic tests passed** (`node --test tests/logic.test.js`).
- **25 / 25 real Chromium integration checks passed** (`python3 tests/chromium.py`).
- Environment: Linux, Chromium **156.0.8078.47**, matching ChromeDriver, Node **18.19.1**.
- Browser checks: service-worker loading and message replies, dashboard/popup, safe defaults,
  five synthetic cookies including CHIPS, first-observation age, protected sites, persistence
  across full browser restarts, UI preview/search/selection, confirmation/cancel/deletion,
  changed-cookie skipping, replay rejection, no values in storage, 360-pixel viewport,
  overdue automatic cleanup and future-alarm restoration, minimal permissions and network CSP.
- Logic checks: invalid settings, domain normalization, partition distinction, unsafe paths,
  unauthorized/private messages, permission loss, incomplete scan ledger preservation, preview
  expiry/foreign IDs/settings changes, unknown stores, value changes, same-value recreation
  during final read, failed deletion checkpoint, callback messaging and corrupt persisted state.
- All cookie operations used fresh disposable profiles and synthetic values only.
- Deterministic ZIP build with root manifest and reviewed file allowlist.

## Gaps and remaining decisions

- Real **Chromium**, not branded Google Chrome. No actual Chrome 130, Windows, macOS,
  Chrome Web Store installation/review, long-duration aging or OS-suspend test performed.
- Narrow layout verified by browser dimensions, not an accessibility certification.
- Firefox source unchanged; original reported Firefox/Android results were not rerun.
- Cookie writes can race the final API removal; browser APIs cannot make that operation atomic.
- Owner authorized a public GitHub repository after review on 2026-10-31.
  Publication includes reviewed source/docs/tests only, not the original ZIP or build artifacts.
- No license selected; no merge, deployment, website edit or store publication performed.

## Official references consulted

- [Chrome cookies / partitions and selector APIs](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [MV3 service worker migration and synchronous listeners](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)

## Licensing update — 2026-11-06

The project owner selected GPL-3.0-only. LICENSE contains the full unmodified
GPLv3 text; Chrome packages include that text and an explicit version-only
declaration. Earlier license-selection statements above describe the original
audit date, not the current licensing state. Original Firefox files/notices
remain byte-identical. No third-party terms, earlier grants, or author identities
were replaced, and no custom mandatory UI-credit condition was added.
