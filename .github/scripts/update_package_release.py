#!/usr/bin/env python3
"""Update package release metadata without fragile text replacement."""

import argparse
import json
import re
from pathlib import Path


REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RELEASE_TAG_RE = re.compile(r"^(?:v\d+\.\d+\.\d+|dev-[0-9a-f]{7,40})$")
PACKAGE_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def update_package_release(
    package_path: Path,
    repository: str,
    release_tag: str,
    sha256: str,
    package_version: str | None = None,
) -> None:
    if not REPOSITORY_RE.fullmatch(repository):
        raise ValueError("repository must use the owner/name format")
    if not RELEASE_TAG_RE.fullmatch(release_tag):
        raise ValueError("release tag must be vX.Y.Z or dev-<git sha>")
    if not SHA256_RE.fullmatch(sha256):
        raise ValueError("dependency SHA-256 must contain 64 lowercase hex characters")
    if package_version is not None and not PACKAGE_VERSION_RE.fullmatch(package_version):
        raise ValueError("package version must use X.Y.Z without a v prefix")

    data = json.loads(package_path.read_text(encoding="utf-8"))
    remote_binaries = data.get("remote_binary")
    if not isinstance(remote_binaries, list):
        raise ValueError("package.json remote_binary must be a list")

    matches = [
        item for item in remote_binaries
        if isinstance(item, dict) and item.get("name") == "plugin-dependencies.tar.gz"
    ]
    if len(matches) != 1:
        raise ValueError("package.json must contain exactly one plugin-dependencies remote binary")

    if package_version is not None:
        data["version"] = package_version

    dependency = matches[0]
    dependency["url"] = (
        f"https://github.com/{repository}/releases/download/"
        f"{release_tag}/plugin-dependencies.tar.gz"
    )
    dependency["sha256hash"] = sha256

    package_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--package-version")
    args = parser.parse_args()

    update_package_release(
        args.package,
        args.repository,
        args.release_tag,
        args.sha256,
        args.package_version,
    )


if __name__ == "__main__":
    main()
