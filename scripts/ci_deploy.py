"""CI deployment for Car Rental.

Mirrors the whavester deploy pattern:

  1. SFTP the working tree to $CARRENTAL_REMOTE_DIR on the deploy host
     (skipping VCS metadata, virtualenvs, secrets, runtime state).
  2. SSH in and run `docker compose up -d --build --force-recreate`
     against the project's docker-compose.yml.

Why paramiko over openssh-client: avoids needing an `apk add openssh`
or similar in the CI image — we run on a shell executor where pip is
available but no system packages.

Safety:
  * We only ever upload — never delete remote files. So .env on the
    server (which we explicitly skip uploading) stays put across
    deploys. So does the postgres named volume.
  * --force-recreate is intentional: docker compose otherwise skips
    recreating the app container if its config hash didn't change,
    which produces "deploy succeeded but the running container still
    serves the old code" bugs when only Python source changed.

Required CI variables (set in GitLab → Settings → CI/CD → Variables):
  CARRENTAL_HOST          deploy server IP/hostname
  CARRENTAL_USER          SSH user
  CARRENTAL_PASS          SSH password (mark masked + protected)
  CARRENTAL_REMOTE_DIR    optional, defaults to /home/$USER/carrental
"""
from __future__ import annotations

import os
import posixpath
import sys
from pathlib import Path

import paramiko


def _require_env_vars(*names: str) -> dict[str, str]:
    """Check every required CI variable is set; if any are missing,
    print all of them in one go so the user only has to retry the
    pipeline once. Exits with rc=2 (distinct from a deploy failure)."""
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        print("FAIL: required CI variable(s) not set in GitLab:")
        for n in missing:
            print(f"   - {n}")
        print("")
        print("Set them in: Settings → CI/CD → Variables.")
        print("   CARRENTAL_HOST          deploy server IP/hostname")
        print("   CARRENTAL_USER          SSH user on that host")
        print("   CARRENTAL_PASS          SSH password (mark masked + protected)")
        print("   CARRENTAL_REMOTE_DIR    optional, defaults to /home/$USER/carrental")
        sys.exit(2)
    return {n: os.environ[n] for n in names}


_env = _require_env_vars("CARRENTAL_HOST", "CARRENTAL_USER", "CARRENTAL_PASS")
HOST        = _env["CARRENTAL_HOST"]
USER        = _env["CARRENTAL_USER"]
PASSWORD    = _env["CARRENTAL_PASS"]
REMOTE_ROOT = os.environ.get(
    "CARRENTAL_REMOTE_DIR", f"/home/{USER}/carrental",
)

# Mirrors .dockerignore + .gitignore — anything that should never
# leave the developer/CI machine.
EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    "node_modules",
    "logs",
    "memory",
    "uploads",                  # runtime media, lives only on the server
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}
EXCLUDE_FILE_SUFFIXES = (".pyc", ".pyo", ".swp")
EXCLUDE_FILE_NAMES    = {".DS_Store", "Thumbs.db"}

# Anything starting with these prefixes (relative to the repo root)
# is skipped. Paths use forward slashes regardless of OS.
EXCLUDE_PREFIXES = (
    ".env",                     # never push .env / .env.local
    "backend/.env",
    "backend/.venv",
    "backend/uploads",
)


def should_skip(rel_posix: str) -> bool:
    parts = rel_posix.split("/")
    for p in parts[:-1]:
        if p in EXCLUDE_DIRS:
            return True
    leaf = parts[-1]
    if leaf in EXCLUDE_DIRS or leaf in EXCLUDE_FILE_NAMES:
        return True
    if any(leaf.endswith(s) for s in EXCLUDE_FILE_SUFFIXES):
        return True
    if any(rel_posix == p or rel_posix.startswith(p + "/")
           for p in EXCLUDE_PREFIXES):
        return True
    return False


def sftp_mkdirs(sftp: paramiko.SFTPClient, remote_dir: str) -> None:
    """`mkdir -p` over SFTP."""
    parts = remote_dir.strip("/").split("/")
    cur = "/" if remote_dir.startswith("/") else ""
    for p in parts:
        cur = (cur + p) if cur.endswith("/") else (cur + "/" + p)
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload(sftp: paramiko.SFTPClient, local_root: Path) -> int:
    count = 0
    for root, dirs, files in os.walk(local_root):
        # Prune in-place so os.walk doesn't descend into excluded dirs.
        dirs[:] = [
            d for d in sorted(dirs)
            if d not in EXCLUDE_DIRS
            and not should_skip(
                str(Path(root, d).relative_to(local_root)).replace("\\", "/")
            )
        ]
        for f in sorted(files):
            rel = (
                str(Path(root, f).relative_to(local_root))
                .replace("\\", "/")
            )
            if should_skip(rel):
                continue
            remote = posixpath.join(REMOTE_ROOT, rel)
            sftp_mkdirs(sftp, posixpath.dirname(remote))
            local_path = str(Path(root) / f)
            sftp.put(local_path, remote)
            count += 1
            # Preserve +x for shell scripts so docker entrypoints,
            # init scripts, etc. stay executable on the server.
            if f.endswith(".sh") or rel.startswith("scripts/"):
                sftp.chmod(remote, 0o755)
    return count


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 900) -> int:
    """Run a remote command and stream its output to CI logs."""
    print(f"\n$ {cmd}", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=timeout, get_pty=True)
    for line in iter(stdout.readline, ""):
        print(line.rstrip(), flush=True)
    rc = stdout.channel.recv_exit_status()
    err = stderr.read().decode(errors="replace").strip()
    if err:
        print("[stderr]", err, flush=True)
    print(f"[rc={rc}]", flush=True)
    return rc


def main() -> int:
    sha = (
        os.environ.get("CI_COMMIT_SHORT_SHA")
        or os.environ.get("CI_COMMIT_SHA", "?")
    )
    print(f"Deploying carrental @ {sha} to {USER}@{HOST}:{REMOTE_ROOT}")

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        HOST,
        username=USER,
        password=PASSWORD,
        look_for_keys=False,
        allow_agent=False,
        timeout=30,
    )

    try:
        sftp = c.open_sftp()
        sftp_mkdirs(sftp, REMOTE_ROOT)
        uploaded = upload(sftp, Path.cwd())
        sftp.close()
        print(f"Uploaded {uploaded} file(s).")

        rc = run(
            c,
            f"cd {REMOTE_ROOT} && "
            "docker compose pull --ignore-pull-failures 2>&1 | tail -40; "
            "docker compose build --pull=false 2>&1 | tail -40 && "
            "docker compose up -d --build --force-recreate 2>&1 | tail -40",
        )
        if rc != 0:
            print("FAIL: docker compose returned non-zero.", flush=True)
            return rc

        # Quick post-deploy visibility — what's running, recent logs.
        run(c, f"cd {REMOTE_ROOT} && docker compose ps")
        run(c, f"cd {REMOTE_ROOT} && docker compose logs --tail=30 app || true")

        return 0
    finally:
        c.close()


if __name__ == "__main__":
    sys.exit(main())
