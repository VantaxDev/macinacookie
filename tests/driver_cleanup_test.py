#!/usr/bin/env python3
"""Pure mocks: never launch ChromeDriver/Chrome or access a real profile/socket."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT=Path(__file__).resolve().parents[1]
source=Path(os.environ.get('MACINACOOKIE_LIFECYCLE_SOURCE',ROOT/'tests/lifecycle.py'))
spec=importlib.util.spec_from_file_location('cleanup_target',source)
m=importlib.util.module_from_spec(spec)
# The original copy lives under dist; provide the real build module location.
sys.path.insert(0,str(ROOT/'scripts'))
spec.loader.exec_module(m)

class Cleanup(unittest.TestCase):
    def setUp(self):
        self.sock=MagicMock();self.sock.getsockname.return_value=('127.0.0.1',12345)
        self.sock.__enter__.return_value=self.sock
        self.log=MagicMock();self.proc=MagicMock()
        self.proc.wait.return_value=0
        self.patches=[patch.object(m.socket,'socket',return_value=self.sock),
            patch.object(m.tempfile,'TemporaryFile',return_value=self.log),
            patch.object(m.subprocess,'Popen',return_value=self.proc),
            patch.object(m.time,'sleep'),patch.object(m.shutil,'which',return_value='/synthetic/chromium')]
        self.mocks=[p.start() for p in self.patches]
        self.addCleanup(lambda:[p.stop() for p in reversed(self.patches)])

    def call(self,method,path,data=None):
        if path=='/status':return {'ready':True}
        if path=='/session':return {'sessionId':'synthetic-session'}
        if path.endswith('/synthetic-session'):return None
        raise AssertionError((method,path))

    def test_session_creation_failure_releases_acquired_resources(self):
        boom=RuntimeError('synthetic POST session failure')
        def call(method,path,data=None):
            if path=='/status':return {}
            raise boom
        with patch.object(m.Driver,'call',side_effect=call):
            with self.assertRaises(RuntimeError) as caught:m.open_browser('/synthetic/not-a-profile','1.2.0')
        self.assertIs(caught.exception,boom)
        self.proc.terminate.assert_called_once()
        self.proc.wait.assert_called_once()
        self.log.close.assert_called_once()

    def test_session_timeout_preserved_even_if_cleanup_errors(self):
        boom=TimeoutError('synthetic lost session response')
        self.proc.terminate.side_effect=OSError('synthetic termination error')
        def call(method,path,data=None):
            if path=='/status':return {}
            raise boom
        with patch.object(m.Driver,'call',side_effect=call):
            with self.assertRaises(TimeoutError) as caught:m.Driver('/synthetic/not-a-profile')
        self.assertIs(caught.exception,boom)
        self.proc.wait.assert_called_once()
        self.log.close.assert_called_once()

    def test_popen_failure_closes_log_and_socket(self):
        boom=OSError('synthetic Popen failure');self.mocks[2].side_effect=boom
        with self.assertRaises(OSError) as caught:m.Driver('/synthetic/not-a-profile')
        self.assertIs(caught.exception,boom)
        self.log.close.assert_called_once()
        self.assertTrue(self.sock.close.called or self.sock.__exit__.called)
        self.proc.terminate.assert_not_called()

    def test_socket_bind_failure_closes_socket_without_process(self):
        self.sock.bind.side_effect=OSError('synthetic bind failure')
        with self.assertRaises(OSError):m.Driver('/synthetic/not-a-profile')
        self.assertTrue(self.sock.close.called or self.sock.__exit__.called)
        self.mocks[1].assert_not_called();self.mocks[2].assert_not_called()

    def test_status_failure_aborts_before_session_and_cleans_up(self):
        calls=[]
        def call(method,path,data=None):
            calls.append(path)
            raise TimeoutError('synthetic status unavailable')
        with patch.object(m.Driver,'call',side_effect=call):
            with self.assertRaises(TimeoutError):m.Driver('/synthetic/not-a-profile')
        self.assertNotIn('/session',calls)
        self.proc.terminate.assert_called_once();self.proc.wait.assert_called_once();self.log.close.assert_called_once()

    def test_successful_close_is_idempotent(self):
        with patch.object(m.Driver,'call',side_effect=self.call) as call:
            d=m.Driver('/synthetic/not-a-profile');d.close();d.close()
        self.assertEqual(sum(c.args[0]=='DELETE' for c in call.call_args_list),1)
        self.proc.terminate.assert_called_once();self.proc.wait.assert_called_once();self.log.close.assert_called_once()

    def test_missing_sid_and_timeout_fallback_only_kills_owned_process(self):
        self.proc.wait.side_effect=[subprocess.TimeoutExpired('owned-child',5),0]
        d=m.Driver.__new__(m.Driver);d.proc=self.proc;d.log=self.log
        with patch.object(m.Driver,'call') as call:d.close();d.close()
        call.assert_not_called();self.proc.terminate.assert_called_once();self.proc.kill.assert_called_once()
        self.assertEqual(self.proc.wait.call_count,2);self.log.close.assert_called_once()

    def test_delete_failure_still_reaps_process_and_closes_log(self):
        with patch.object(m.Driver,'call',side_effect=self.call):d=m.Driver('/synthetic/not-a-profile')
        boom=RuntimeError('synthetic DELETE failure')
        with patch.object(m.Driver,'call',side_effect=boom):
            with self.assertRaises(RuntimeError) as caught:d.close()
            self.assertIs(caught.exception,boom);d.close()
        self.proc.terminate.assert_called_once();self.proc.wait.assert_called_once();self.log.close.assert_called_once()

    def test_open_failure_preserved_if_teardown_also_fails(self):
        boom=ValueError('synthetic open failure')
        with patch.object(m.Driver,'call',side_effect=self.call),patch.object(m.Driver,'open',side_effect=boom),patch.object(m.Driver,'close',side_effect=OSError('cleanup')):
            with self.assertRaises(ValueError) as caught:m.open_browser('/synthetic/not-a-profile','1.2.0')
        self.assertIs(caught.exception,boom)

if __name__=='__main__':unittest.main(verbosity=2)
