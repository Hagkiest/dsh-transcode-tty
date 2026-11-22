#!/bin/sh
# Install dsh-transcode-tty into a DeepSeek Harness profile.
#
# A thin wrapper around scripts/install.mjs for macOS and Linux shells, so the
# documented one-liner works without remembering the script path.
#
#   ./install.sh
#   ./install.sh --profile-dir /home/me/.dsh/profiles/work

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
installer="$repo_root/scripts/install.mjs"

if [ ! -f "$installer" ]; then
	echo "Cannot find $installer. Run this script from a clone of the repository." >&2
	exit 1
fi

if ! command -v node >/dev/null 2>&1; then
	echo "Node.js was not found on PATH." >&2
	echo "Install Node.js 20 or newer from https://nodejs.org and run this script again." >&2
	exit 1
fi

version=$(node --version)
major=$(printf '%s' "$version" | sed 's/^v//' | cut -d. -f1)
if [ "$major" -lt 20 ]; then
	echo "Node.js $version is too old. This plugin needs Node.js 20 or newer." >&2
	exit 1
fi

exec node "$installer" "$@"
