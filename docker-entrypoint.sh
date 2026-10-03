#!/bin/sh
set -eu

# Docker named volumes and bind mounts can be created as root.
# Ensure SQLite has a writable directory before dropping privileges.
mkdir -p /app/data
chown -R appuser:appuser /app/data

exec gosu appuser "$@"
