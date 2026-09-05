#!/usr/bin/env bash
# Unit tests for scripts/lib/common.sh: no Docker required.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"

describe "portta_slug: hostnames must be DNS-safe"
it "lowercases"                  ; assert_eq "baseempresarial" "$(portta_slug 'BaseEmpresarial')"
it "replaces underscores"        ; assert_eq "base-empresarial" "$(portta_slug 'base_empresarial')"
it "collapses repeated dashes"   ; assert_eq "a-b" "$(portta_slug 'a___b')"
it "trims leading dashes"        ; assert_eq "abc" "$(portta_slug '_abc')"
it "trims trailing dashes"       ; assert_eq "abc" "$(portta_slug 'abc_')"
it "handles dots"                ; assert_eq "a-b-c" "$(portta_slug 'a.b.c')"
it "keeps digits"                ; assert_eq "issue59" "$(portta_slug 'issue59')"
it "survives mixed punctuation"  ; assert_eq "base-empresarial-issue-59" "$(portta_slug 'Base_Empresarial/Issue#59')"

describe "portta_is_true: .env values people actually write"
for v in 1 true TRUE yes Yes on enabled; do
  it "accepts '$v'"; assert_success portta_is_true "$v"
done
for v in 0 false no off "" disabled maybe; do
  it "rejects '$v'"; assert_failure portta_is_true "$v"
done

describe "portta_load_env: parses, never executes"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/.env" <<'ENV'
# a comment
PORTTA_TEST_PLAIN=value
PORTTA_TEST_QUOTED="quoted value"
PORTTA_TEST_SINGLE='single'
PORTTA_TEST_EMPTY=
export PORTTA_TEST_EXPORTED=exported
PORTTA_TEST_EQUALS=a=b=c
not a valid line
PORTTA_TEST_INJECT=`touch /tmp/portta-should-not-exist`
ENV

PORTTA_TEST_PRESET=fromshell
export PORTTA_TEST_PRESET
echo 'PORTTA_TEST_PRESET=fromfile' >> "$tmp/.env"

portta_load_env "$tmp/.env"

it "reads a plain value"            ; assert_eq "value" "${PORTTA_TEST_PLAIN:-}"
it "strips double quotes"           ; assert_eq "quoted value" "${PORTTA_TEST_QUOTED:-}"
it "strips single quotes"           ; assert_eq "single" "${PORTTA_TEST_SINGLE:-}"
it "keeps empty values empty"       ; assert_eq "" "${PORTTA_TEST_EMPTY-unset}"
it "tolerates a leading 'export'"   ; assert_eq "exported" "${PORTTA_TEST_EXPORTED:-}"
it "keeps '=' inside a value"       ; assert_eq "a=b=c" "${PORTTA_TEST_EQUALS:-}"
it "lets the installation file win" ; assert_eq "fromfile" "${PORTTA_TEST_PRESET:-}"
it "does not execute substitutions" ; assert_failure test -e /tmp/portta-should-not-exist

describe "portta_defaults: an empty .env still yields a working local gateway"
unset PORTTA_DOMAIN PORTTA_NETWORK PORTTA_BIND_ADDRESS PORTTA_PROFILE
portta_defaults
it "defaults the domain to localhost"     ; assert_eq "localhost" "$PORTTA_DOMAIN"
it "defaults the network name"            ; assert_eq "portta" "$PORTTA_NETWORK"
it "binds to loopback by default"         ; assert_eq "127.0.0.1" "$PORTTA_BIND_ADDRESS"
it "defaults to the local profile"        ; assert_eq "local" "$PORTTA_PROFILE"

describe "portta_json_escape"
it "escapes double quotes"  ; assert_eq 'say \"hi\"' "$(portta_json_escape 'say "hi"')"
it "escapes backslashes"    ; assert_eq 'a\\\\b' "$(portta_json_escape 'a\\b')"

describe "portta_env_set: the file keeps its identity"

# .env is bind-mounted into the panel container as a single file, and a file
# bind follows the inode. Replacing the file here left the panel holding an
# unlinked one, reporting .env as missing until it was recreated -- and every
# host-side write did it.
env_dir=$(mktemp -d)
env_file="$env_dir/.env"
printf 'A=one\n# a comment\nB=two\n' > "$env_file"
inode_before=$(ls -i "$env_file" | awk '{print $1}')

portta_env_set A three "$env_file"
portta_env_set C four "$env_file"

it "updates the value in place"
assert_eq "three" "$(grep '^A=' "$env_file" | cut -d= -f2)"

it "appends a key that was absent"
assert_eq "four" "$(grep '^C=' "$env_file" | cut -d= -f2)"

it "keeps the comments around it"
assert_contains "$(cat "$env_file")" "# a comment"

it "and never replaces the file"
assert_eq "$inode_before" "$(ls -i "$env_file" | awk '{print $1}')"

it "leaving no temporary behind"
assert_eq ".env .env-lock" "$(ls -A "$env_dir" | tr '\n' ' ' | sed 's/ $//')"

it "and still owner-only"
assert_eq "-rw-------" "$(ls -l "$env_file" | cut -c1-10)"

rm -rf "$env_dir"

describe "the constants the zero-Node fallback shares with portta-core"

# ADR 0015 keeps a Bash implementation of the core commands, so a handful of
# facts exist twice. Each one is a contract, not a second source of truth, and
# these assertions are what a "keep them in sync" comment used to be.
if ! command -v node >/dev/null 2>&1; then
  it "constant parity"; skip "node is unavailable"
else
  core_const() {
    node --input-type=module -e "
      import * as core from '$PORTTA_ROOT/packages/core/src/index.ts'
      process.stdout.write(String(core.$1))
    " 2>/dev/null
  }

  it "slugs agree, because Traefik serves the name the panel prints"
  for value in 'BaseEmpresarial' 'base_empresarial' 'a___b' '_abc' 'abc_' 'a.b.c' 'Base_Empresarial/Issue#59'; do
    assert_eq "$(portta_slug "$value")" "$(core_const "slug('$value')")"
  done
fi

t_summary
