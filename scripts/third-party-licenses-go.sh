#!/bin/sh
# Prints the license texts of the Go modules linked into the binary.
#
# Input (stdin), one module per line: "<module path> <version> <module dir>",
# as produced by
#   go list -deps -tags prod -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}{{end}}' ./cmd/jarvis | sort -u
#
# Every module must ship a LICENSE/LICENCE/COPYING file; NOTICE and PATENTS
# files are included when present. A module without a license file, or one
# that is not downloaded, fails the run: shipping its code without the notice
# its license requires is the thing this guards against.
#
# POSIX sh, so it runs in the golang:alpine build stage.

set -u

status=0
count=0
missing=""

while read -r path version dir; do
  [ -n "$path" ] || continue
  count=$((count + 1))
  if [ -z "${dir:-}" ] || [ ! -d "$dir" ]; then
    echo "third-party licenses: $path $version has no module directory (not downloaded?)" >&2
    status=1
    continue
  fi

  found=0
  out=""
  for f in "$dir"/LICENSE* "$dir"/LICENCE* "$dir"/COPYING* "$dir"/NOTICE* "$dir"/PATENTS*; do
    [ -f "$f" ] || continue
    case "$(basename "$f")" in
      LICENSE*|LICENCE*|COPYING*) found=1 ;;
    esac
    out="$out
--- $(basename "$f") ---
$(cat "$f")
"
  done

  if [ "$found" -eq 0 ]; then
    echo "third-party licenses: $path $version has no LICENSE/COPYING file" >&2
    status=1
    continue
  fi

  printf '================================================================================\n%s %s\n================================================================================\n%s\n' "$path" "$version" "$out"
done

if [ "$count" -eq 0 ]; then
  echo "third-party licenses: no modules on stdin (did the go list command fail?)" >&2
  status=1
fi

exit "$status"
