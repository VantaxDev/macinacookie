# Business footer update

Scope: footer-only change against the Firefox baseline on main. The Chrome port
in PR #1 is deliberately not bundled or modified. The original source archive and
import commit remain available unchanged; the existing project tagline, status,
links and license status are preserved.

Both dashboard and popup render the business line using the browser's current
local year. A local deferred script refreshes it every second and on visibility
changes, so open pages and resumed tabs follow year rollover. VAT is assembled
from ["043", "706", "00274"] and displayed completely as accessible DOM text.

Splitting source strings does NOT prevent search association: rendered business
name and VAT remain indexable. There is no crawler-specific behavior, cloaking,
or hidden alternate business identity. No CSP, permission or dependency changes.

Verification:

- `node tests/footer.test.cjs`: exact text/VAT, 2026 → 2027 rollover without reload,
  resumed-tab refresh to 2028, both HTML entry points.
- `node --check upstream/firefox/business-footer.js`: pass.
- Chromium rendering of actual HTML/CSS/JS: dashboard at 360 and 1280 CSS pixels,
  popup at 355 CSS pixels; visible complete line, wrapping within viewport,
  simulated open-page 2026 → 2027 rollover all pass.
- These are footer rendering checks, not Firefox extension integration testing.

Deployment: this project is an extension, not a standalone hosted website.
No hosted deployment target exists in this checkout. No store release, merge,
website edit, configuration change or unrelated Chrome publication performed.
The main-based PR must be reviewed/landed and a distribution route authorized
before users receive an updated extension. The shared Vantax project post belongs
to the website project and is not changed from this extension checkout.
