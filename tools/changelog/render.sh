#!/usr/bin/env bash
# Render CHANGELOG.md from the annotated release tags (#346).
#
# The tag message IS the changelog: `/mk-release` writes the notes into the
# annotated `vX.Y.Z` tag, `publish-github` posts that same text as the GitHub
# Release, and this script renders every such tag into one Keep-a-Changelog
# file. One source — a CHANGELOG maintained by hand next to the tags would
# drift from them within two releases.
#
# The chicken-and-egg: CHANGELOG.md must be IN the tree the tag points at, and
# the tag does not exist until after that tree is committed. So the release
# recipe renders the entry it is about to tag from the notes file (`--pending`),
# commits the result, and tags that commit with the same notes. The next
# release re-renders from tags alone and produces the identical entry, because
# the notes file became the tag message verbatim.
#
#   tools/changelog/render.sh > CHANGELOG.md
#   tools/changelog/render.sh --pending vX.Y.Z notes.md > CHANGELOG.md
#
# `notes.md` is the file `git tag -a -F` is given: subject line, blank line,
# body. Only the body is rendered; the subject ("MakeKeeper vX.Y.Z") is the
# Release title and says nothing the heading does not.
#
# Pure: reads tags from the current repository, writes Markdown to stdout, no
# network. Deterministic for a given set of tags, so a re-render is a no-op
# diff unless a tag changed — which is how the release gate checks that the
# file was regenerated (see publish-github.yml).
set -euo pipefail

REPO_URL=${CHANGELOG_REPO_URL:-https://github.com/makekeeper/makekeeper}
TAG_GLOB='v[0-9]*'

pending_version=''
pending_notes=''
while [ $# -gt 0 ]; do
  case "$1" in
    --pending)
      pending_version=${2:?--pending needs a version (vX.Y.Z)}
      pending_notes=${3:?--pending needs the notes file}
      shift 3
      ;;
    *)
      echo "usage: $0 [--pending vX.Y.Z notes.md]" >&2
      exit 2
      ;;
  esac
done

# A repository is the only input; outside one, `git tag` inside the process
# substitution below would fail unseen and the output would be a header alone.
git rev-parse --git-dir >/dev/null 2>&1 || { echo "not inside a git repository" >&2; exit 2; }

# The same cleanup `git tag --cleanup=whitespace` applies to a message: trailing
# whitespace off every line, runs of blank lines collapsed to one, no leading or
# trailing blank lines. Applied to BOTH sources — the tag body and the pending
# notes — so the pending entry and its re-render from the tag are identical.
clean_body() {
  sed -e 's/[[:space:]]*$//' | cat -s | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
}

# One entry: heading with the version and its date, then the body, then a blank
# line. A tag cut before the notes convention (#303) has only a subject; its
# entry says so instead of being silently empty — the reader is told where the
# notes stop, not left to wonder whether the rendering broke.
render_entry() {
  local version=$1 date=$2 body=$3
  printf '## [%s] - %s\n\n' "${version#v}" "$date"
  if printf '%s' "$body" | grep -q '[^[:space:]]'; then
    printf '%s\n\n' "$body"
  else
    printf '_No release notes were written for this version._\n\n'
  fi
}

versions=()

if [ -n "$pending_version" ]; then
  case "$pending_version" in
    *-*) echo "'$pending_version' is a prerelease; the changelog lists final releases only" >&2; exit 2 ;;
  esac
  # Exactly three numeric parts, the shape the image tags and the update
  # checker read a release by; a `v1.2` entry would name no real release.
  [[ $pending_version =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "pending version must look like vX.Y.Z, got '$pending_version'" >&2
    exit 2
  }
  if git rev-parse -q --verify "refs/tags/$pending_version" >/dev/null; then
    echo "tag $pending_version already exists — render without --pending" >&2
    exit 2
  fi
  [ -r "$pending_notes" ] || { echo "cannot read notes file '$pending_notes'" >&2; exit 2; }
fi

# Unquoted so ${REPO_URL} expands, which makes every backtick a command
# substitution: each one is escaped, or the header runs what it names.
cat <<HEADER
# Changelog

All notable changes to MakeKeeper, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

This file is rendered from the release tags by \`tools/changelog/render.sh\` —
each entry is the text of its annotated tag, which is also what the matching
[GitHub Release](${REPO_URL}/releases) shows. Do
not edit it by hand: the next release regenerates it.

HEADER

if [ -n "$pending_version" ]; then
  # Everything after the subject line: `%(contents:body)` is what follows the
  # first blank line, leading blank lines dropped.
  body=$(awk 'found { print } /^[[:space:]]*$/ && !found { found = 1 }' "$pending_notes" | clean_body)
  render_entry "$pending_version" "$(date -u +%F)" "$body"
  versions+=("$pending_version")
fi

# Annotated tags only: a lightweight `v*` tag has no message of its own and
# `%(contents:body)` would fall through to the commit's. `--sort=-v:refname`
# orders by version, not by date, so a patch cut for an older line lands where
# a reader looks for it. Dates in UTC (`-local` under TZ=UTC), the same clock
# the pending entry is stamped with, so a tag cut late in the evening does not
# move by a day on the next render.
#
# Final releases only: a hyphen in the version (`v1.0.0-rc.1`) is a candidate,
# the same reading the update checker (#304) and the image tags (#358) apply.
# A candidate is pullable by name and invisible everywhere else, including here.
while IFS='|' read -r version date type; do
  [ "$type" = tag ] || continue
  case "$version" in *-*) continue ;; esac
  body=$(git tag -l --format='%(contents:body)' "$version" | clean_body)
  render_entry "$version" "$date" "$body"
  versions+=("$version")
done < <(TZ=UTC git tag -l "$TAG_GLOB" --sort=-v:refname \
  --format='%(refname:strip=2)|%(taggerdate:short-local)|%(objecttype)')

# Reference links, Keep-a-Changelog style, so `[0.18.2]` in a heading is a link.
# `${arr[@]+...}`: an empty array is "unbound" to bash 3.2's `set -u`.
for version in ${versions[@]+"${versions[@]}"}; do
  printf '[%s]: %s/releases/tag/%s\n' "${version#v}" "$REPO_URL" "$version"
done
