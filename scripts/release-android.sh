#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release-android.sh X.Y.Z [--push]

Without --push the script creates the release commit (when needed) and annotated
tag locally. With --push it atomically pushes main and the tag; that starts both
the production deployment and the signed Android GitHub Release workflow.
EOF
}

fail() {
  printf 'release: %s\n' "$1" >&2
  exit 1
}

is_semver() {
  [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
}

semver_gt() {
  local left_major left_minor left_patch right_major right_minor right_patch
  IFS=. read -r left_major left_minor left_patch <<< "$1"
  IFS=. read -r right_major right_minor right_patch <<< "$2"

  if (( 10#$left_major != 10#$right_major )); then
    (( 10#$left_major > 10#$right_major ))
    return
  fi
  if (( 10#$left_minor != 10#$right_minor )); then
    (( 10#$left_minor > 10#$right_minor ))
    return
  fi
  (( 10#$left_patch > 10#$right_patch ))
}

read_property() {
  local key="$1" file="$2"
  awk -F= -v key="$key" '$1 == key { print $2 }' "$file"
}

if (( $# < 1 || $# > 2 )); then
  usage
  exit 2
fi

requested_version="$1"
publish=false
if (( $# == 2 )); then
  [[ "$2" == '--push' ]] || fail "unknown option: $2"
  publish=true
fi
is_semver "$requested_version" || fail 'version must be strict numeric SemVer (X.Y.Z)'

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

[[ "$(git branch --show-current)" == 'main' ]] || fail 'release must be prepared from main'
[[ -z "$(git status --porcelain)" ]] || fail 'working tree must be clean before release'

version_file='frontend/native-version.properties'
[[ -f "$version_file" ]] || fail "missing $version_file"
node scripts/update-native-version.mjs --check

current_version="$(read_property VERSION_NAME "$version_file")"
current_code="$(read_property VERSION_CODE "$version_file")"
is_semver "$current_version" || fail 'tracked VERSION_NAME is invalid'
[[ "$current_code" =~ ^[1-9][0-9]*$ ]] || fail 'tracked VERSION_CODE is invalid'

git fetch --prune origin main --tags
git merge-base --is-ancestor origin/main HEAD || fail 'local main is behind or diverged from origin/main'

if [[ "$publish" == true ]]; then
  command -v gh >/dev/null || fail 'GitHub CLI is required with --push'
  gh auth status --hostname github.com >/dev/null || fail 'GitHub CLI is not authenticated'
  secret_names="$(gh secret list --json name --jq '.[].name')" || fail 'cannot list GitHub Actions secrets'
  for required_secret in \
    ANDROID_KEYSTORE_B64 \
    ANDROID_KEYSTORE_PASSWORD \
    ANDROID_KEY_ALIAS \
    ANDROID_KEY_PASSWORD
  do
    grep -Fqx "$required_secret" <<< "$secret_names" || fail "missing GitHub Actions secret: $required_secret"
  done
fi

tag="v$requested_version"
if git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null; then
  fail "tag $tag already exists"
fi

latest_version=''
while IFS= read -r candidate_tag; do
  candidate_version="${candidate_tag#v}"
  if is_semver "$candidate_version" && { [[ -z "$latest_version" ]] || semver_gt "$candidate_version" "$latest_version"; }; then
    latest_version="$candidate_version"
  fi
done < <(git tag --list 'v*')

if [[ -n "$latest_version" ]] && ! semver_gt "$requested_version" "$latest_version"; then
  fail "version $requested_version must be greater than latest release $latest_version"
fi
if semver_gt "$current_version" "$requested_version"; then
  fail "version $requested_version is lower than tracked version $current_version"
fi

version_changed=false
if semver_gt "$requested_version" "$current_version"; then
  new_code=$((10#$current_code + 1))
  node scripts/update-native-version.mjs --set "$requested_version" "$new_code"
  version_changed=true
elif [[ "$requested_version" != "$current_version" ]]; then
  fail "version $requested_version cannot be compared with tracked version $current_version"
fi

if [[ -n "$latest_version" ]]; then
  previous_properties="$(git show "v$latest_version:$version_file")"
  previous_code="$(printf '%s\n' "$previous_properties" | awk -F= '$1 == "VERSION_CODE" { print $2 }')"
  [[ "$previous_code" =~ ^[1-9][0-9]*$ ]] || fail "release v$latest_version has invalid VERSION_CODE"
  release_code="$(read_property VERSION_CODE "$version_file")"
  (( 10#$release_code > 10#$previous_code )) || \
    fail "VERSION_CODE must be greater than release v$latest_version code $previous_code"
fi

node scripts/update-native-version.mjs --check

(
  cd frontend
  npm test
  npm run lint
  npm run typecheck
  npm run build
)

if [[ "$version_changed" == true ]]; then
  unexpected_changes=''
  while IFS= read -r status_line; do
    changed_path="${status_line:3}"
    case "$changed_path" in
      frontend/native-version.properties|frontend/ios/App/App.xcodeproj/project.pbxproj) ;;
      *) unexpected_changes+="$status_line"$'\n' ;;
    esac
  done < <(git status --porcelain)
  [[ -z "$unexpected_changes" ]] || fail "checks produced unexpected tracked changes:\n$unexpected_changes"

  git add frontend/native-version.properties frontend/ios/App/App.xcodeproj/project.pbxproj
  git commit -m "chore(release): v$requested_version"
else
  [[ -z "$(git status --porcelain)" ]] || fail 'checks produced unexpected tracked changes'
fi

git tag -a "$tag" -m "yv-chat $tag"

if [[ "$publish" == true ]]; then
  if ! git push --atomic origin main "refs/tags/$tag"; then
    fail "push failed; local commit/tag remain. Retry: git push --atomic origin main refs/tags/$tag"
  fi
  printf 'Published %s: production deployment and Android release workflows started.\n' "$tag"
else
  printf 'Prepared %s locally. Publish explicitly with:\n' "$tag"
  printf '  git push --atomic origin main refs/tags/%s\n' "$tag"
fi
