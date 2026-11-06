"""Packaging regression checks using only Python's standard library."""
import hashlib
import json
import pathlib
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXPECTED = {
    'manifest.json', 'service-worker.js', 'core.js', 'background.js',
    'dashboard.html', 'dashboard.css', 'dashboard.js', 'popup.html', 'popup.js',
    'icons/cookie.svg', *[f'icons/cookie-{n}.png' for n in (16, 32, 48, 128)],
}


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='macinacookie-build-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        shutil.copytree(ROOT / 'extension', self.root / 'extension')
        (self.root / 'scripts').mkdir()
        shutil.copy2(ROOT / 'scripts/build.py', self.root / 'scripts/build.py')
        self.output = self.root / 'dist/macinacookie-chrome-1.2.0.zip'

    def build(self, optimized=False):
        return subprocess.run([sys.executable, *(['-O'] if optimized else []),
                               str(self.root / 'scripts/build.py')],
                              capture_output=True, text=True)

    def seed_output(self):
        self.output.parent.mkdir()
        self.output.write_bytes(b'previous reviewed artifact')

    def assert_preserved(self):
        self.assertEqual(self.output.read_bytes(), b'previous reviewed artifact')
        self.assertEqual(list(self.output.parent.iterdir()), [self.output])

    def test_exact_contents_root_manifest_and_reproducibility(self):
        # Sensitive/unrelated files must never be swept into the allowlisted ZIP.
        for name in ('.env', 'private.zip', 'upstream/firefox/background.js'):
            path = self.root / 'extension' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic-do-not-package')
        first = self.build()
        self.assertEqual(first.returncode, 0, first.stderr)
        original = self.output.read_bytes()
        self.assertIn(hashlib.sha256(original).hexdigest(), first.stdout)
        with zipfile.ZipFile(self.output) as package:
            self.assertEqual(set(package.namelist()), EXPECTED)
            self.assertEqual(len(package.namelist()), len(EXPECTED))
            self.assertIsNone(package.testzip())
            manifest = json.loads(package.read('manifest.json'))
            self.assertEqual(manifest['version'], '1.2.0')
            for name in EXPECTED:
                self.assertEqual(package.read(name), (self.root / 'extension' / name).read_bytes())
        self.assertEqual(self.build().returncode, 0)
        self.assertEqual(original, self.output.read_bytes())

    def test_invalid_versions_preserve_output_even_with_python_optimized(self):
        self.seed_output()
        path = self.root / 'extension/manifest.json'
        manifest = json.loads(path.read_text())
        invalid = ['.', '1..2', '.1', '1.', '1.2.3.4.5', '65536',
                   '01.2', '1.00', '0', '0.0.0.0', '', '../escape', 12, None]
        for optimized in (False, True):
            for version in invalid:
                with self.subTest(version=version, optimized=optimized):
                    manifest['version'] = version
                    path.write_text(json.dumps(manifest))
                    result = self.build(optimized=optimized)
                    self.assertNotEqual(result.returncode, 0, result.stdout)
                    self.assert_preserved()

    def test_valid_version_boundaries(self):
        path = self.root / 'extension/manifest.json'
        manifest = json.loads(path.read_text())
        for version in ('1', '0.1', '1.2.3.4', '65535.65535.65535.65535'):
            with self.subTest(version=version):
                manifest['version'] = version
                path.write_text(json.dumps(manifest))
                result = self.build()
                self.assertEqual(result.returncode, 0, result.stderr)
                output = self.root / 'dist' / f'macinacookie-chrome-{version}.zip'
                with zipfile.ZipFile(output) as package:
                    self.assertEqual(json.loads(package.read('manifest.json'))['version'], version)

    def test_missing_file_preserves_existing_package(self):
        self.seed_output()
        (self.root / 'extension/service-worker.js').unlink()
        self.assertNotEqual(self.build().returncode, 0)
        self.assert_preserved()

    def test_symlink_preserves_existing_package_even_with_python_optimized(self):
        self.seed_output()
        target = self.root / 'extension/service-worker.js'
        target.unlink()
        outside = self.root / 'unrelated.js'
        outside.write_text('synthetic-do-not-package')
        target.symlink_to(outside)
        self.assertNotEqual(self.build(optimized=True).returncode, 0)
        self.assert_preserved()

    def test_zip_write_failure_preserves_output_and_cleans_temporary(self):
        self.seed_output()
        original = zipfile.ZipFile.writestr
        writes = 0

        def fail_second_write(package, *args, **kwargs):
            nonlocal writes
            writes += 1
            if writes == 2:
                raise OSError('synthetic disk failure')
            return original(package, *args, **kwargs)

        namespace = runpy.run_path(str(self.root / 'scripts/build.py'))
        with mock.patch.object(zipfile.ZipFile, 'writestr', fail_second_write):
            with self.assertRaisesRegex(OSError, 'synthetic disk failure'):
                namespace['build']()
        self.assert_preserved()

    def test_replace_failure_preserves_output_and_cleans_temporary(self):
        self.seed_output()
        namespace = runpy.run_path(str(self.root / 'scripts/build.py'))
        with mock.patch('os.replace', side_effect=OSError('synthetic replace failure')):
            with self.assertRaisesRegex(OSError, 'synthetic replace failure'):
                namespace['build']()
        self.assert_preserved()

    def test_symlinked_icon_directory_rejected(self):
        self.seed_output()
        icons = self.root / 'extension/icons'
        outside = self.root / 'unrelated-icons'
        icons.rename(outside)
        icons.symlink_to(outside, target_is_directory=True)
        self.assertNotEqual(self.build(optimized=True).returncode, 0)
        self.assert_preserved()

    def test_permission_validation_survives_python_optimized(self):
        self.seed_output()
        path = self.root / 'extension/manifest.json'
        manifest = json.loads(path.read_text())
        manifest['permissions'].append('history')
        path.write_text(json.dumps(manifest))
        self.assertNotEqual(self.build(optimized=True).returncode, 0)
        self.assert_preserved()


if __name__ == '__main__':
    unittest.main()
