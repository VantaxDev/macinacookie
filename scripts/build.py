#!/usr/bin/env python3
"""Build a reproducible extension-only ZIP using a reviewed file allowlist."""
import hashlib
import json
import os
import pathlib
import re
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
FILES = ['LICENSE', 'LICENSING.md', 'manifest.json', 'service-worker.js', 'core.js', 'background.js',
         'dashboard.html', 'dashboard.css', 'dashboard.js', 'popup.html', 'popup.js',
         'icons/cookie.svg', *[f'icons/cookie-{n}.png' for n in (16, 32, 48, 128)]]


def build():
    # Validate and snapshot before opening output. Explicit checks remain active
    # under python -O, unlike assert. Reject symlinked parent directories too.
    sources = {}
    for name in sorted(FILES):
        path = EXT / name
        parents = [EXT / parent for parent in pathlib.Path(name).parents]
        if not path.is_file() or any(p.is_symlink() for p in (path, EXT, *parents)):
            raise ValueError(f'Not a regular, non-symlinked source: {name}')
        sources[name] = path.read_bytes()
    manifest = json.loads(sources['manifest.json'])
    if (manifest['manifest_version'] != 3 or
            manifest['permissions'] != ['cookies', 'storage', 'alarms'] or
            manifest['incognito'] != 'not_allowed'):
        raise ValueError('Manifest does not match reviewed safety constraints')
    version = manifest['version']
    # Chrome accepts one to four canonical decimal components, each <= 65535,
    # with at least one nonzero component. Reject before creating any output.
    if (not isinstance(version, str) or
            re.fullmatch(r'(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}', version) is None or
            any(int(part) > 65535 for part in version.split('.')) or
            not any(int(part) for part in version.split('.'))):
        raise ValueError('Invalid package version')
    out = ROOT / 'dist' / f'macinacookie-chrome-{version}.zip'
    out.parent.mkdir(exist_ok=True)
    # Same-directory temporary output allows an atomic replacement only after
    # successful ZIP finalization. Failures preserve any previously built ZIP.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=out.parent, prefix='.macinacookie-', suffix='.tmp', delete=False) as handle:
            temporary = pathlib.Path(handle.name)
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for name, content in sources.items():
                info = zipfile.ZipInfo(name, date_time=(2026, 10, 31, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                package.writestr(info, content)
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(out)
    print('SHA256', digest)


if __name__ == '__main__':
    build()
