"""Prepare untrusted PR data and publish a review from trusted workflow code."""

import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import urllib.request


CONFIG_DIRS = {".git", ".opencode", ".claude", ".agents"}
INSTRUCTION_FILES = {"AGENTS.md", "CLAUDE.md", "CONTEXT.md", "REVIEW.md"}


def is_private_env(path):
    return path.name.startswith(".env") and path.name != ".env.example"


def git(source, *args):
    return subprocess.check_output(
        ["git", "-c", "core.hooksPath=/dev/null", "-C", str(source), *args]
    )


def prepare(source, destination, base, head):
    """Copy only regular tracked blobs from immutable commits, without execution."""
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        raise ValueError("Expected full Git commit hashes")
    if git(source, "rev-parse", "HEAD").decode().strip() != head:
        raise ValueError("Checkout does not match the requested PR commit")

    files = []
    for entry in git(source, "ls-tree", "-rz", "--full-tree", head).split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        mode, kind, oid = metadata.split()
        path = PurePosixPath(os.fsdecode(raw_path))
        if mode not in (b"100644", b"100755") or kind != b"blob":
            raise ValueError("Review snapshots cannot contain symlinks or submodules")
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid tracked path")
        # Keep configuration and instructions in the diff, never as executable
        # plugins, custom tools, automatically loaded instructions, or skills.
        if CONFIG_DIRS.intersection(path.parts) or path.name in INSTRUCTION_FILES:
            continue
        if is_private_env(path):
            continue
        files.append((path, oid.decode()))

    comparison = f"{base}...{head}"
    # Filter both sides, including deletions, with a fixed number of pathspecs.
    # A separate pass restores safe examples without exposing other .env files.
    diff_args = (
        "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
        "--unified=40", comparison, "--",
    )
    diff = git(
        source, *diff_args, ".", ":(glob,exclude)**/.env*",
    ) + git(
        source, *diff_args, ":(glob)**/.env.example",
    )
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for path, oid in files:
        target = destination / "source" / path
        target.parent.mkdir(parents=True, exist_ok=True)
        # No checkout filters, Git hooks, archive attributes, or executable bits.
        target.write_bytes(git(source, "cat-file", "blob", oid))
    (destination / "changes.diff").write_bytes(diff)
    print(f"Prepared {len(files)} source files at {head}")


def review_text(events):
    text = None
    for line in events.splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") == "error":
            raise ValueError("OpenCode reported an error; no review will be posted")
        if event.get("type") == "text":
            text = event.get("part", {}).get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("OpenCode did not return a review")
    if len(text) > 60000:
        raise ValueError("Review exceeds GitHub's comment limit")
    return text.strip()


def github(path, token, body=None):
    request = urllib.request.Request(
        f"https://api.github.com/{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def publish(events_path, repository, number, head, run_id, token):
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository):
        raise ValueError("Invalid repository")
    if not number.isdecimal() or not run_id.isdecimal() or not re.fullmatch(r"[0-9a-f]{40}", head):
        raise ValueError("Invalid review identity")
    text = review_text(Path(events_path).read_text())
    pr = github(f"repos/{repository}/pulls/{number}", token)
    if pr["state"] != "open" or pr["draft"] or pr["head"]["sha"] != head:
        print("PR is closed, draft, or has changed; skipping stale review")
        return
    body = (
        f"## OpenCode review\n\n{text}\n\n---\n"
        f"Reviewed commit `{head}` with DeepSeek V4.1 Flash (low effort).\n"
        f"[Workflow run](https://github.com/{repository}/actions/runs/{run_id})"
    )
    github(f"repos/{repository}/issues/{number}/comments", token, {"body": body})
    print("Posted OpenCode review")


if __name__ == "__main__":
    if sys.argv[1] == "prepare":
        prepare(Path(sys.argv[2]), Path(sys.argv[3]), os.environ["REVIEW_BASE_SHA"], os.environ["REVIEW_HEAD_SHA"])
    elif sys.argv[1] == "publish":
        publish(
            sys.argv[2], os.environ["GITHUB_REPOSITORY"], os.environ["REVIEW_PR_NUMBER"],
            os.environ["REVIEW_HEAD_SHA"], os.environ["GITHUB_RUN_ID"], os.environ["GH_TOKEN"],
        )
    else:
        raise ValueError("Expected prepare or publish")
