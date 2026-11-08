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
import hashlib
from pathlib import Path

PROJECT = "/home/roomhacker/excode/.git"
DEPLOY = "/home/roomhacker/services/kanban-board"
CONTAINER = "kanban-board-kanban-1"
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]
EMERGENCY = "AGENT_HERDER_EMERGENCY_UNMERGED_ROLLOUT"
TARGET = {"fleetDir": DEPLOY, "unit": CONTAINER}
FILES = [DEPLOY + "/docker-compose.yml", DEPLOY + "/docker-compose.deploy.yml",
         "/home/roomhacker/agents-projects/exmanager/deploy/todo/docker-compose.runtime.yml"]

def command(argv):
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("DOCKER_", "COMPOSE_")) and k != EMERGENCY}
    return subprocess.check_output(argv, text=True, env=env).strip()

def image_revision(image, run=command):
    return run(DOCKER + ["image", "inspect", image, "--format",
                '{{index .Config.Labels "org.opencontainers.image.revision"}}'])

def live(run=command):
    return run(DOCKER + ["inspect", CONTAINER, "--format", "{{.Image}}"])

def reject_emergency():
    if os.environ.get(EMERGENCY, "").strip():
        raise RuntimeError("emergency_override_forbidden")

def input_hashes(paths):
    return {p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
            if Path(p).exists() else None for p in paths}

def durable_override(image, root):
    data = json.dumps({"services": {"kanban": {"image": image}}}, sort_keys=True)
    path = Path(root) / (hashlib.sha256(data.encode()).hexdigest() + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_text() != data:
            raise RuntimeError("release_manifest_conflict")
    else:
        with path.open("x") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    return str(path)

def release(gate, expected_image, expected_revision, candidate_image, candidate_revision,
            run=command, override=None, input_snapshot=None):
    reject_emergency()
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
    compose = DOCKER + ["compose", "--project-name", "kanban-board", "--project-directory", DEPLOY]
    for path in FILES + [override]:
        compose += ["-f", path]
    paths = FILES + [override, DEPLOY + "/.env",
                        "/home/roomhacker/todo-kanban/work-auth/runtime.env"]
    baseline = input_snapshot if input_snapshot is not None else input_hashes(paths)
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
        reject_emergency()
        if input_hashes(paths) != baseline:
            raise RuntimeError("compose_inputs_changed")
        run(compose + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "kanban"])
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
    reject_emergency()
    override = durable_override(a.candidate_image, DEPLOY + "/release-images")
    print(json.dumps(release(gate, a.expected_image, a.expected_revision,
                             a.candidate_image, a.candidate_revision, override=override)))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No capability or untrusted command output in the console.
        print("todo_release_failed; inspect current runtime before retry", file=sys.stderr)
        sys.exit(1)
