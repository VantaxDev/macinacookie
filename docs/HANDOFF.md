# Owner / coordinator handoff

## Repository and package

- Public repository authorized by the owner: **VantaxDev/macinacookie**.
- `main` contains the unchanged Firefox source import and a donation-linked README.
- `feat/chrome-mv3` contains the Chrome port, intended for an unmerged review PR.
- Reproducible package: `dist/macinacookie-chrome-1.2.0.zip` (local artifact, not in Git).
- Run `python3 scripts/build.py` to rebuild and print its SHA-256.
- No merge, deployment, website modification or store publication is authorized here.

## Remaining decisions and distribution

Public visibility is resolved. The project owner has selected GPL-3.0-only.
The complete license is in LICENSE; Chrome packages include LICENSE and
LICENSING.md. The original archive had no explicit license; existing original
source/notices are preserved, and no prior third-party grants are revoked.

The Chrome port remains in review; do not merge or publish to an extension store without
separate authority. Upload the ZIP only through an approved release/distribution route;
it is currently a local build, not a store release. Original source archives, browser
profiles, private workspace memory, local configuration and build outputs are not published.

## Project post / donations — no edit required for existing note

Verified read-only on 2026-10-31:

- Italian: https://vantax.eu/it/post/2026-10-26
- English: https://vantax.eu/en/post/2026-10-26

Both already contain a donation-welcome sentence and a donation link. Leave payment
setup with the Alternpress owner. The owner supplied https://paypal.me/vantax; the
repository READMEs link to that destination. No new payment setup or destination invented.

Suggested Italian wording if a copy refresh is desired:

> Macinacookie ti è utile? Le donazioni sono benvenute e aiutano a sostenere lo sviluppo del progetto.

Suggested English wording:

> If Macinacookie is useful to you, donations are welcome and help support its development.

The post currently describes Firefox/Android and links to Mozilla Add-ons. After an actual
Chrome distribution URL exists, the Alternpress owner can add Chrome installation guidance;
do not describe this unpublished local ZIP as a store release.
