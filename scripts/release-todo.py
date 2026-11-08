#!/usr/bin/env python3
"""Guarded Todo Compose release. No lease creation, build, or implicit rollback."""
import argparse
import importlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT = "/home/roomhacker/excode/.git"
DEPLOY = "/home/roomhacker/services/kanban-board"
CONTAINER = "kanban-board-kanban-1"
TARGET = {"fleetDir": DEPLOY, "unit": CONTAINER}
FILES = [DEPLOY + "/docker-compose.yml", DEPLOY + "/docker-compose.deploy.yml",
         "/home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml"]

def command(argv):
    return subprocess.check_output(argv, text=True).strip()

def image_revision(image, run=command):
    return run(["docker", "image", "inspect", image, "--format",
                '{{index .Config.Labels "org.opencontainers.image.revision"}}'])

def live(run=command):
    return run(["docker", "inspect", CONTAINER, "--format", "{{.Image}}"])

def release(gate, expected_image, expected_revision, candidate_image, candidate_revision,
            run=command, override=None):
    for sha in [expected_revision, candidate_revision]:
        if not re.fullmatch(r"[a-f0-9]{40}", sha):
            raise ValueError("invalid_revision")
    for image in [expected_image, candidate_image]:
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
            raise ValueError("immutable_image_required")
    if gate.proof["project"] != PROJECT:
        raise RuntimeError("release_project_mismatch")
    if gate.target != TARGET:
        raise RuntimeError("release_target_mismatch")
    if not override:
        raise ValueError("image_override_required")
    compose = ["docker", "compose", "--project-directory", DEPLOY]
    for path in FILES + [override]:
        compose += ["-f", path]
    with gate:
        gate.candidate_descends_from(expected_revision, candidate_revision)
        if image_revision(candidate_image, run) != candidate_revision:
            raise RuntimeError("candidate_image_revision_mismatch")
        run(compose + ["config", "--quiet"])
        # Final fence and revision checks occur under the shared project/target OS locks.
        gate.check()
        if live(run) != expected_image or image_revision(expected_image, run) != expected_revision:
            raise RuntimeError("production_revision_changed")
        gate.check()
        run(compose + ["up", "-d", "--no-build", "--pull", "never", "kanban"])
        # An uncertain/failed command is not retried and does not cause blind rollback.
        gate.check()
        if live(run) != candidate_image:
            raise RuntimeError("deployed_image_mismatch")
        if image_revision(candidate_image, run) != candidate_revision:
            raise RuntimeError("deployed_revision_mismatch")
        run(["curl", "--fail", "--silent", "--show-error", "--max-time", "15",
             "--output", "/dev/null", "http://127.0.0.1:43327/"])
    return {"image": candidate_image, "revision": candidate_revision,
            "health": "http_ok", "user_path_acceptance": "pending"}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ["proof", "ledger", "release-gate-dir", "expected-image",
                 "expected-revision", "candidate-image", "candidate-revision"]:
        p.add_argument("--" + name, required=True)
    a = p.parse_args()
    for path in [a.proof, a.ledger]:
        f = Path(path)
        if not f.is_absolute() or str(f.resolve(strict=True)) != path:
            raise ValueError("canonical_existing_path_required")
    if stat.S_IMODE(Path(a.proof).stat().st_mode) & 0o077:
        raise ValueError("private_proof_required")
    # Operator must independently verify this is the existing authority's gate.
    directory = Path(a.release_gate_dir)
    if not directory.is_absolute() or directory.resolve(strict=True) != directory:
        raise ValueError("canonical_gate_directory_required")
    sys.path.insert(0, str(directory))
    gate_type = importlib.import_module("release_gate").ReleaseGate
    gate = gate_type(a.proof, state_path=a.ledger, target=TARGET)
    with tempfile.TemporaryDirectory(prefix="todo-release-") as temp:
        override = str(Path(temp) / "image.json")
        Path(override).write_text(json.dumps({"services": {"kanban": {"image": a.candidate_image}}}))
        print(json.dumps(release(gate, a.expected_image, a.expected_revision,
                                 a.candidate_image, a.candidate_revision, override=override)))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No capability or untrusted command output in the console.
        print("todo_release_failed; inspect current runtime before retry", file=sys.stderr)
        sys.exit(1)
