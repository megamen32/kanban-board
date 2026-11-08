import importlib.util
import unittest
import os
import tempfile
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("todo_release", Path(__file__).with_name("release-todo.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OLD, NEW = "sha256:" + "a"*64, "sha256:" + "b"*64
R1, R2 = "1"*40, "2"*40

class Gate:
    proof = {"project": m.PROJECT}
    target = m.TARGET
    def __init__(self): self.checks = 0; self.expire = None
    def __enter__(self): self.check(); return self
    def __exit__(self, *args): pass
    def candidate_descends_from(self, *args): self.check()
    def check(self):
        self.checks += 1
        if self.expire == self.checks: raise RuntimeError("expired")

class ReleaseTest(unittest.TestCase):
    def setUp(self):
        self.gate = Gate(); self.current = OLD; self.commands = []
        self.bad_candidate = False; self.failed_up = False
    def run_command(self, argv):
        self.commands.append(argv)
        if argv[:5] == m.DOCKER + ["image", "inspect"]:
            return R1 if argv[5] == OLD or self.bad_candidate else R2
        if argv[:4] == m.DOCKER + ["inspect"]: return self.current
        if "up" in argv:
            if self.failed_up: raise RuntimeError("unknown")
            self.current = NEW
        return ""
    def release(self):
        return m.release(self.gate, OLD, R1, NEW, R2, self.run_command, "/fixture/image.json")
    def no_up(self): self.assertFalse(any("up" in a for a in self.commands))
    def test_success_preserves_three_files_and_no_build(self):
        self.assertEqual(self.release()["user_path_acceptance"], "pending")
        up = next(a for a in self.commands if "up" in a)
        self.assertIn("--no-build", up)
        self.assertIn("--no-deps", up)
        self.assertEqual(up[:3], m.DOCKER)
        self.assertIn("--project-name", up)
        for f in m.FILES: self.assertIn(f, up)
        self.assertEqual(up[-4:], ["--no-build", "--pull", "never", "kanban"])
    def test_changed_live_rejected(self):
        self.current = NEW
        with self.assertRaisesRegex(RuntimeError, "production_revision_changed"): self.release()
        self.no_up()
    def test_wrong_candidate_rejected(self):
        self.bad_candidate = True
        with self.assertRaisesRegex(RuntimeError, "candidate_image_revision"): self.release()
        self.no_up()
    def test_expired_fence_rejected_before_up(self):
        self.gate.expire = 4
        with self.assertRaisesRegex(RuntimeError, "expired"): self.release()
        self.no_up()
    def test_no_retry_or_rollback_after_uncertain_up(self):
        self.failed_up = True
        with self.assertRaisesRegex(RuntimeError, "unknown"): self.release()
        self.assertEqual(sum("up" in a for a in self.commands), 1)
    def test_wrong_project_rejected(self):
        self.gate.proof = {"project": "/other/.git"}
        with self.assertRaisesRegex(RuntimeError, "release_project_mismatch"): self.release()
        self.no_up()
    def test_wrong_target_rejected(self):
        self.gate.target = {"unit": "other"}
        with self.assertRaisesRegex(RuntimeError, "release_target_mismatch"): self.release()
        self.no_up()

    def test_emergency_env_rejected(self):
        with patch.dict(os.environ, {m.EMERGENCY: "emergency"}):
            with self.assertRaisesRegex(RuntimeError, "emergency_override_forbidden"): self.release()
        self.no_up()
    def test_changed_inputs_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "compose_inputs_changed"):
            m.release(self.gate, OLD, R1, NEW, R2, self.run_command,
                      "/fixture/image.json", {"different": "snapshot"})
        self.no_up()
    def test_durable_manifest_survives_and_reuses(self):
        with tempfile.TemporaryDirectory() as d:
            path = m.durable_override(NEW, d)
            self.assertTrue(Path(path).exists())
            self.assertEqual(m.durable_override(NEW, d), path)
            self.assertNotEqual(m.durable_override(OLD, d), path)
    def test_command_removes_docker_compose_environment(self):
        with patch.dict(os.environ, {"DOCKER_CONTEXT": "foreign", "COMPOSE_PROJECT_NAME": "foreign"}):
            with patch.object(m.subprocess, "check_output", return_value="ok") as run:
                m.command(["true"])
                self.assertNotIn("DOCKER_CONTEXT", run.call_args.kwargs["env"])
                self.assertNotIn("COMPOSE_PROJECT_NAME", run.call_args.kwargs["env"])


    def test_expiry_during_hashing_blocks_up(self):
        original = m.input_hashes
        calls = 0
        def hashing(paths):
            nonlocal calls
            calls += 1
            result = original(paths)
            if calls == 2:
                self.gate.expire = self.gate.checks + 1
            return result
        with patch.object(m, "input_hashes", side_effect=hashing):
            with self.assertRaisesRegex(RuntimeError, "expired"): self.release()
        self.no_up()
    def test_health_bypasses_proxy(self):
        self.release()
        health = next(a for a in self.commands if a[0] == "curl")
        self.assertEqual(health[1:3], ["--noproxy", "*"])
        self.assertEqual(health[-1], "http://127.0.0.1:43327/")

if __name__ == "__main__": unittest.main()
