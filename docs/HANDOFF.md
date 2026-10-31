# Owner / coordinator handoff

## Ready locally

- Proposed GitHub repository: **VantaxDev/macinacookie**.
- Branch: `feat/chrome-mv3`, based on the untouched Firefox source import on `main`.
- Reproducible package: `dist/macinacookie-chrome-1.2.0.zip`.
- Run `python3 scripts/build.py` to rebuild and print its SHA-256.
- No remote, push, repository creation, PR, merge, deployment or store publication yet.

## Decision required

**Should `VantaxDev/macinacookie` be private or public?** No public upload until the owner
chooses visibility. Keep all current work local while this decision is pending.
A source license has not been chosen; the original archive contains no license file.

After the visibility decision, create the repository with the chosen visibility, push
`main` (source import) and `feat/chrome-mv3`, then open a review PR. Do not merge or publish
to an extension store without separate authority. Attach the Chrome ZIP only through an
approved release/distribution route; none is currently published.

## Project post / donations — no edit required for existing note

Verified read-only on 2026-10-31:

- Italian: https://vantax.eu/it/post/2026-10-26
- English: https://vantax.eu/en/post/2026-10-26

Both already contain a donation-welcome sentence and a donation link. Leave payment
setup and the existing destination with the Alternpress owner. No new destination needed.

Suggested Italian wording if a copy refresh is desired:

> Macinacookie ti è utile? Le donazioni sono benvenute e aiutano a sostenere lo sviluppo del progetto.

Suggested English wording:

> If Macinacookie is useful to you, donations are welcome and help support its development.

The post currently describes Firefox/Android and links to Mozilla Add-ons. After an actual
Chrome distribution URL exists, the Alternpress owner can add Chrome installation guidance;
do not describe this unpublished local ZIP as a store release.
