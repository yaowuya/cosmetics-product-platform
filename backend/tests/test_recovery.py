"""Verify the required restore/second-instance evidence without deploying or modifying a host."""
from hashlib import file_digest, sha256
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit

import httpx
import pytest

RESTORE_SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "restore.sh"


def test_corrupt_bundle_preflight(tmp_path):
    """A signed bundle with damaged file contents must be rejected before any import."""
    # Exercise the actual verifier separately from GPG/container I/O. The signature line is
    # this unit's input, not a claim that signing, encryption or cross-host restore ran.
    script = RESTORE_SCRIPT.read_text(encoding="utf-8")
    verifier = script.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]
    fingerprint = "A" * 40
    (tmp_path / "signatures").write_text(f"[GNUPG:] VALIDSIG {fingerprint}\n", encoding="ascii")
    entries = {"db.sql": b"-- snapshot\n", "schema": b"0002_config_items\n", "image": b"approved-image\n",
               "source_project": b"source-sandbox\n", "captured_at": b"2026-11-22T00:00:00Z\n",
               "assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": b"expected bytes"}
    manifest = {name: sha256(content).hexdigest() for name, content in entries.items()}
    entries["manifest.json"] = json.dumps(manifest).encode()
    entries["assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] = b"damaged bytes"
    with tarfile.open(tmp_path / "payload.tar", "w") as bundle:
        for name, content in entries.items():
            child = tarfile.TarInfo(name)
            child.size = len(content)
            bundle.addfile(child, BytesIO(content))
    result = subprocess.run([sys.executable, "-I", "-c", verifier, str(tmp_path), "isolated-restore", fingerprint,
                             "0002_config_items", "approved-image"], capture_output=True, timeout=10)
    assert result.returncode != 0
    assert b"Backup checksum mismatch" in result.stderr


def _shell_path(path):
    """Use MSYS paths for Git Bash tools; drive-letter GPG socket paths do not work on Windows."""
    if os.name == "nt":
        return subprocess.run(["bash", "-c", 'cygpath -u "$1"', "_", Path(path).as_posix()],
                              capture_output=True, text=True, check=True, timeout=5).stdout.strip()
    return str(path)


@pytest.fixture
def signed_restore_fixture(tmp_path):
    """Build a genuinely signed/encrypted fixture using a disposable GPG keyring."""
    with tempfile.TemporaryDirectory(prefix="fp-gpg-") as home:
        home_arg = _shell_path(home)
        env = {**os.environ, "GNUPGHOME": home_arg}

        def gpg(*args):
            """Use the temporary keyring, never an operator's keyring."""
            result = subprocess.run(["gpg", "--homedir", home_arg, "--batch", "--pinentry-mode", "loopback",
                                     "--passphrase", "", *args], env=env, capture_output=True, text=True, timeout=15)
            assert result.returncode == 0, result.stderr
            return result.stdout

        try:
            gpg("--quick-gen-key", "Disposable bundle acceptance", "ed25519", "sign", "1d")
            keys = gpg("--with-colons", "--list-secret-keys").splitlines()
            signer = next(row.split(":")[9] for row in keys if row.startswith("fpr:"))
            gpg("--quick-add-key", signer, "cv25519", "encrypt", "1d")
            entries = {"db.sql": b"-- disposable snapshot\n", "schema": b"0002_config_items\n",
                       "image": b"fixture-image\n", "source_project": b"source-sandbox\n", "captured_at": b"2026-11-22T00:00:00Z\n",
                       "assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": b"private fixture"}
            manifest = {name: sha256(content).hexdigest() for name, content in entries.items()}
            entries["manifest.json"] = json.dumps(manifest).encode()
            archive, encrypted = tmp_path / "fixture.tar", tmp_path / "fixture.gpg"
            with tarfile.open(archive, "w") as bundle:
                for name, content in entries.items():
                    child = tarfile.TarInfo(name)
                    child.size = len(content)
                    bundle.addfile(child, BytesIO(content))
            gpg("--local-user", signer, "--recipient", signer, "--output", _shell_path(encrypted),
                "--sign", "--encrypt", _shell_path(archive))
            env.update(SHOWCASE_APPROVED_RESTORE_PROJECT="isolated-restore", SHOWCASE_EXPECT_SCHEMA="0002_config_items",
                       SHOWCASE_EXPECT_API_IMAGE_ID="fixture-image", SHOWCASE_BACKUP_SIGNER=signer,
                       SHOWCASE_PYTHON_BIN=_shell_path(sys.executable))
            env.pop("SHOWCASE_ASSET_DIR", None)
            yield ["bash", _shell_path(RESTORE_SCRIPT), "--project", "isolated-restore", "--bundle", _shell_path(encrypted)], env
        finally:
            subprocess.run(["gpgconf", "--homedir", home_arg, "--kill", "gpg-agent"],
                           env=env, capture_output=True, timeout=10)


def test_real_signed_bundle_verification_without_docker(signed_restore_fixture):
    """Preflight an authentic bundle without selecting a live database or Docker target."""
    command, env = signed_restore_fixture
    valid = subprocess.run([*command, "--verify-only"], env=env, capture_output=True, text=True, timeout=20)
    assert valid.returncode == 0, valid.stderr
    assert "Verified signed bundle" in valid.stdout
    invalid = subprocess.run([*command, "--verify-only"], env={**env, "SHOWCASE_BACKUP_SIGNER": "0" * 40},
                             capture_output=True, text=True, timeout=20)
    assert invalid.returncode != 0 and "no signature from the approved signer" in invalid.stderr


def test_restore_stops_if_container_status_is_unknown(signed_restore_fixture, tmp_path):
    """A failed Compose status probe must stop restore before any database access."""
    command, env = signed_restore_fixture
    tools, assets = tmp_path / "tools", tmp_path / "assets"
    tools.mkdir(); assets.mkdir()
    trace = tmp_path / "docker-trace"
    fake = tools / "docker"
    fake.write_text(
        '#!/usr/bin/env bash\n'
        'printf "%s\\n" "$*" >> "$FP_DOCKER_TRACE"\n'
        'case "$1" in image) printf "fixture-image\\n";; compose)\n'
        'case " $* " in *" ps "*) exit 42;; *" exec "*) printf "0\\n";; *) exit 98;; esac;; *) exit 99;; esac\n',
        encoding="utf-8", newline="\n",
    )
    fake.chmod(0o700)
    # The Windows test host has Python under its installed path, not the python3 alias.
    python3 = tools / "python3"
    python3.write_text('#!/usr/bin/env bash\nexec "$SHOWCASE_PYTHON_BIN" "$@"\n', encoding="utf-8", newline="\n")
    python3.chmod(0o700)
    env.update(SHOWCASE_ASSET_DIR=_shell_path(assets), FP_DOCKER_TRACE=_shell_path(trace))
    guarded = ["bash", "-c", 'tool_dir=$1; shift; export PATH="$tool_dir:$PATH"; '
               '[[ $(command -v docker) == "$tool_dir/docker" ]] || exit 99; exec "$@"', "_", _shell_path(tools), *command]
    result = subprocess.run(guarded, env=env, capture_output=True, text=True, timeout=20)
    seen = trace.read_text(encoding="utf-8")
    assert " ps " in seen, result.stderr
    assert result.returncode != 0 and " exec " not in seen


def test_clean_host_rejects_aliases_before_any_network(tmp_path, monkeypatch):
    """Equivalent origin spellings cannot count as three independent deployments."""
    manifest = tmp_path / "acceptance.json"
    manifest.write_text(json.dumps({"source": "https://EXAMPLE.invalid", "restored": "https://example.invalid:443/",
                                    "second": "https://example.invalid//"}), encoding="utf-8")
    monkeypatch.setenv("FP_RECOVERY_ACCEPTANCE_MANIFEST", str(manifest))
    with pytest.raises(AssertionError, match="distinct HTTPS origins"):
        test_clean_host()


def _https_origin(value: str) -> str:
    """Normalize safe root HTTPS origins before comparing and requesting them."""
    parsed = urlsplit(value)
    assert (parsed.scheme == "https" and parsed.hostname and parsed.username is None and parsed.password is None
            and not parsed.query and not parsed.fragment and not parsed.path.strip("/")), "Expected a root HTTPS origin"
    host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    assert host, "Expected a root HTTPS origin"
    authority = f"[{host}]" if ":" in host else host
    port = parsed.port
    return f"https://{authority}" + (f":{port}" if port not in {None, 443} else "")


def _fetch(origin: str, route: str) -> httpx.Response:
    assert route.startswith("/api/public/") and not route.startswith("//")
    return httpx.get(origin + route, timeout=10, follow_redirects=False)


def test_clean_host():
    """Require an explicitly supplied approved acceptance manifest for the three environments."""
    configured = os.environ.get("FP_RECOVERY_ACCEPTANCE_MANIFEST")
    assert configured, "BLOCKED: supply the approved second-tenant and clean-host recovery acceptance manifest"
    info = json.loads(Path(configured).read_text(encoding="utf-8"))
    origins = [_https_origin(info[name]) for name in ("source", "restored", "second")]
    assert len(set(origins)) == 3, "Expected three distinct HTTPS origins for source, restored and second"
    assert info["source_host_identity"] != info["restored_host_identity"]
    bundle = Path(info["encrypted_bundle"])
    with bundle.open("rb") as stream:
        assert file_digest(stream, "sha256").hexdigest() == info["bundle_sha256"]
    # An operator supplies scoped evidence from the real authorized editor sessions separately;
    # this HTTP probe checks anonymous behavior and does not collect session secrets itself.
    evidence = info["verified_private_evidence"]
    assert evidence["draft_sha256"] == evidence["restored_draft_sha256"]
    assert evidence["history_sha256"] == evidence["restored_history_sha256"]
    assert evidence["recovery_point"] == info["recovery_point"] and evidence["operator_confirmed"] is True
    source, restored, second = origins
    expected = info["source_product"]
    for host in (source, restored):
        detail = _fetch(host, f"/api/public/products/{expected['id']}")
        assert detail.status_code == 200 and detail.json()["body"]["name"] == expected["name"]
        photo = _fetch(host, expected["media_path"])
        assert photo.status_code == 200 and sha256(photo.content).hexdigest() == expected["media_sha256"]
        assert _fetch(host, info["private_media_path"]).status_code == 404
    foreign = info["second_product"]
    detail = _fetch(second, f"/api/public/products/{foreign['id']}")
    assert detail.status_code == 200 and detail.json()["body"]["name"] == foreign["name"]
    assert detail.json()["body"]["name"] != expected["name"]
