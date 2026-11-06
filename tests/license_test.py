"""License text/declaration and built package checks; no browser required."""
import hashlib
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GPL_SHA256 = '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'

class LicenseTests(unittest.TestCase):
    def test_complete_license_and_version_only_declaration(self):
        text = (ROOT / 'LICENSE').read_bytes()
        self.assertEqual(hashlib.sha256(text).hexdigest(), GPL_SHA256)
        self.assertEqual(text, (ROOT / 'extension/LICENSE').read_bytes())
        self.assertIn('SPDX-License-Identifier: GPL-3.0-only', (ROOT / 'extension/LICENSING.md').read_text())
        self.assertIn('**GPL-3.0-only**', (ROOT / 'README.md').read_text())

    def test_packaged_license_and_declaration(self):
        path = ROOT / 'dist/macinacookie-chrome-1.2.0.zip'
        with zipfile.ZipFile(path) as package:
            self.assertIsNone(package.testzip())
            self.assertEqual(len(package.namelist()), 16)
            self.assertEqual(len(package.namelist()), len(set(package.namelist())))
            for name in ('LICENSE', 'LICENSING.md'):
                self.assertEqual(package.read(name), (ROOT / 'extension' / name).read_bytes())
            for name in package.namelist():
                self.assertFalse(name.startswith('/') or '..' in name.split('/'))
                self.assertEqual(package.read(name), (ROOT / 'extension' / name).read_bytes())

if __name__ == '__main__':
    unittest.main(verbosity=2)
