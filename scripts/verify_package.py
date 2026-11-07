#!/usr/bin/env python3
"""Verify an existing ZIP, then test its extracted bytes with synthetic data only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

from build import FILES

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    parser.add_argument('--sha256', required=True, help='Expected checkpoint SHA-256')
    parser.add_argument('--checks', choices=['full', 'branding', 'consent', 'qa'], default='full',
                        help='Consent: gate regressions and focused packaged UI smoke; no unrelated suites')
    parser.add_argument('--ui-only', action='store_true', help='Recapture/check UI without repeating unchanged Node regressions')
    args = parser.parse_args()
    package = args.package.resolve()
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    if digest != args.sha256:
        raise ValueError('Package does not match the requested checkpoint')
    output = ROOT / 'dist' / ('verified-' + digest[:12])
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='macinacookie-package-check-') as temporary:
        temporary = Path(temporary)
        extension = temporary / 'extension'
        with zipfile.ZipFile(package) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or set(names) != set(FILES):
                raise ValueError('Unexpected, missing or duplicate archive entries')
            if archive.testzip() is not None:
                raise ValueError('ZIP CRC check failed')
            for name in FILES:
                if archive.read(name) != (ROOT / 'extension' / name).read_bytes():
                    raise ValueError('Source/package byte mismatch: ' + name)
            # The reviewed allowlist is checked before any extraction.
            archive.extractall(extension)
        manifest = json.loads((extension / 'manifest.json').read_text())
        print(f'PASS SHA-256, CRC, allowlist and byte identity ({len(FILES)} files)', flush=True)
        tests = temporary / 'tests'
        tests.mkdir()
        shutil.copyfile(ROOT / 'tests' / 'logic.test.js', tests / 'logic.test.js')
        pattern = 'authorized persisted consent' if args.checks == 'branding' else 'persisted record IDs'
        if args.checks == 'consent':
            shutil.copyfile(ROOT / 'tests' / 'consent.test.js', tests / 'consent.test.js')
        commands = [
            ('node-audit.txt' if args.checks == 'branding' else 'id-regression.txt', ['node', '--test', '--test-name-pattern=' + pattern, str(tests / 'logic.test.js')], os.environ.copy()),
            ('chromium.txt', ['python3', str(ROOT / 'tests' / 'chromium.py')],
             {**os.environ, 'MACINACOOKIE_EXTENSION': str(extension),
              'MACINACOOKIE_SCREENSHOTS': str(output / 'screenshots')}),
        ]
        if args.checks in ('branding', 'consent'):
            commands[1][2]['MACINACOOKIE_CHECKS'] = args.checks
        if args.checks == 'consent':
            commands[0] = ('consent-regressions.txt', ['node', '--test', str(tests / 'consent.test.js')], os.environ.copy())
        if args.checks == 'qa':
            shutil.copyfile(ROOT / 'tests' / 'qa-regressions.js', tests / 'qa-regressions.js')
            commands[0] = ('qa-regressions.txt', ['node', str(tests / 'qa-regressions.js')],
                           {**os.environ, 'MACINACOOKIE_EXTENSION': str(extension),
                            'MACINACOOKIE_QA_OUTPUT': str(output / 'qa')})
            commands[1][2]['MACINACOOKIE_CHECKS'] = 'consent'
        if args.ui_only:
            commands = commands[1:]
        for name, command, env in commands:
            result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
            (output / name).write_text(result.stdout)
            print(result.stdout, end='', flush=True)
            result.check_returncode()
        evidence = {'package': str(package), 'sha256': digest, 'files': len(FILES),
                    'manifest_version': manifest['manifest_version'], 'version': manifest['version'],
                    'browser': subprocess.check_output(['chromium', '--version'], text=True).strip(),
                    'scope': 'extracted ZIP; ' + args.checks + ' checks' + ('; UI only' if args.ui_only else '')}
        (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
        print('Evidence:', output)


if __name__ == '__main__':
    main()
