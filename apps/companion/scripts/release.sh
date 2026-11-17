#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
#
# Builds and updates of the companion app at Expo (EAS), for the GitHub workflows companion-build.yml
# (by hand) and companion-update.yml (every push to main that changes the app, once its tests passed).
#
#   bash apps/companion/scripts/release.sh update                    # an over-the-air update where a build can run it
#   bash apps/companion/scripts/release.sh build --platform android  # a new build: android, ios or all
#   bash apps/companion/scripts/release.sh build --platform android --apk-release
#        # and, once the APK is built, it replaces the one of the GitHub pre-release `companion-android`
#        # (a fixed address a target app can link to until the app is in Google Play); with it goes
#        # `latest.json`, the runtime of the newest build per platform, from which the app tells that a new
#        # build is out (src/lib/newBuild.ts). An iOS build is then waited for too, and only a finished one
#        # is written there.
#
# An update reaches only builds of the same runtime (the fingerprint of the native part). Where none
# exists - a new native module, an SDK upgrade - `update` says so and leaves the build to a person:
# builds start only by hand. Needs EXPO_TOKEN (a robot of the Expo organisation that owns the project)
# and the project id in app.config.ts; without them nothing happens, and the run's summary says why.
#
# EAS_CLI, EXPO_CONFIG, RESOLVE_RUNTIME, EAS_JSON, GH_CLI and DOWNLOAD can be swapped for stubs (scripts/release.test.ts).
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC2086 # the commands are meant to split into their words
eas() { ${EAS_CLI:-npx --yes eas-cli@27} "$@"; }
# shellcheck disable=SC2086
expo_config() { ${EXPO_CONFIG:-npx expo config --type public --json}; }
# shellcheck disable=SC2086
resolve_runtime() { ${RESOLVE_RUNTIME:-npx expo-updates runtimeversion:resolve --workflow managed} --platform "$1"; }
# shellcheck disable=SC2086
gh_cli() { ${GH_CLI:-gh} "$@"; }
# shellcheck disable=SC2086
download() { ${DOWNLOAD:-curl -fsSL --retry 3 -o} "$1" "$2"; }

# The APK's pre-release: one tag, moved to each new Android build, so its address stays the same.
APK_TAG=companion-android
APK_NAME=golf-launch-monitor-sync-companion.apk
LATEST_NAME=latest.json

say() {
  printf '%s\n' "$*"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n\n' "$*" >> "$GITHUB_STEP_SUMMARY"; fi
}
warn() {
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; fi
  say "$*"
}
fail() {
  say "$*"
  exit 1
}
# Reads JSON from stdin and prints what the expression makes of `j`; fails on nothing or junk. Nothing at all
# (a refused command printed only its reason) fails quietly, so the reason stays the last word of the log.
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!s.trim())process.exit(1);let v;try{const j=JSON.parse(s.trim());v=('"$1"')}catch(e){console.error(String(e));process.exit(1)}if(v===undefined||v===null||v==="")process.exit(1);console.log(v)})'; }

channel=preview
profile_of() { if [ "$1" = ios ]; then echo testflight; else echo preview; fi; }

command="${1:-}"
if [ $# -gt 0 ]; then shift; fi
want=all
apk_release=false
while [ $# -gt 0 ]; do
  case "$1" in
    --apk-release) apk_release=true ;;
    --platform)
      [ $# -ge 2 ] || fail "--platform needs android, ios or all."
      want="$2"
      shift
      ;;
    *) fail "Unknown option: $1 (allowed: --platform android|ios|all, --apk-release)." ;;
  esac
  shift
done
case "$command" in update | build) ;; *) fail "Usage: release.sh update | build [--platform android|ios|all]" ;; esac
case "$want" in android | ios | all) ;; *) fail "--platform needs android, ios or all (not $want)." ;; esac
if [ "$apk_release" = true ] && [ "$command" != build ]; then fail "--apk-release goes with build only."; fi

if [ -z "${EXPO_TOKEN:-}" ]; then
  warn "No EXPO_TOKEN (the release environment's secret): nothing built or published. apps/companion/README.md, \"Builds and updates\"."
  exit 0
fi

project="$(expo_config | json 'j.extra && j.extra.eas && j.extra.eas.projectId')" || {
  warn "No EAS project id in app.config.ts (EAS_PROJECT_ID): nothing built or published. apps/companion/README.md, \"Builds and updates\"."
  exit 0
}

# The iPhone takes part once its App Store Connect record is in eas.json (submit profile "testflight", ascAppId):
# without it a build couldn't go to TestFlight.
ios_ready=false
if EAS_JSON_PATH="$(cd "$(dirname "${EAS_JSON:-eas.json}")" && pwd)/$(basename "${EAS_JSON:-eas.json}")" \
  node -e 'const s=require(process.env.EAS_JSON_PATH).submit?.testflight?.ios; process.exit(s && /^\d+$/.test(String(s.ascAppId||"")) ? 0 : 1)'; then
  ios_ready=true
fi
platforms=()
# iOS first: without --apk-release it is only started, and the iPhone's build needn't wait behind the APK.
if [ "$want" != android ]; then
  if [ "$ios_ready" = true ]; then
    platforms+=(ios)
  elif [ "$want" = ios ]; then
    fail "iOS isn't set up yet (eas.json: submit.testflight.ios.ascAppId is missing; apps/companion/README.md)."
  else
    say "iOS: not set up yet (no ascAppId in eas.json), Android only."
  fi
fi
if [ "$want" != ios ]; then platforms+=(android); fi

message="$(git log -1 --format=%s 2>/dev/null || true)"
message="${message:-Companion app}"

# latest.json for the platform $1 built with runtime $2, into the file $3: what the pre-release had for the
# other platform stays (a build of one doesn't make the other's older). The app reads only `runtime`.
latest_json() {
  local platform="$1" runtime="$2" out="$3" prev version
  prev="$(mktemp)"
  gh_cli release download "$APK_TAG" --pattern "$LATEST_NAME" --output "$prev" --clobber >/dev/null 2>&1 || : > "$prev"
  version="$(expo_config | json 'j.version' 2>/dev/null)" || version=""
  PREV="$prev" OUT="$out" PLATFORM="$platform" RUNTIME="$runtime" VERSION="$version" \
    COMMIT="$(git log -1 --format=%h 2>/dev/null || echo "${GITHUB_SHA:-main}")" node -e '
      const fs = require("fs");
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(process.env.PREV, "utf8")); } catch {}
      const out = { format: "glmsync-companion/1" };
      for (const p of ["android", "ios"]) {
        const e = prev && prev[p];
        if (e && typeof e === "object" && typeof e.runtime === "string") out[p] = e;
      }
      out[process.env.PLATFORM] = { runtime: process.env.RUNTIME, ...(process.env.VERSION ? { version: process.env.VERSION } : {}),
        commit: process.env.COMMIT, built_at: new Date().toISOString() };
      fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 2) + "\n");' || fail "latest.json could not be written."
  rm -f "$prev"
}

# The runtime a build was made for: Expo's own answer, else what this checkout works out.
runtime_of() {
  local out="$1" platform="$2" r
  r="$(printf '%s' "$out" | json 'j[0].runtimeVersion' 2>/dev/null)" && { printf '%s' "$r"; return; }
  resolve_runtime "$platform" | json 'j.runtimeVersion'
}

# The finished APK into the pre-release (replacing the one before), for a phone to install with one tap; latest.json
# with it.
apk_to_release() {
  local url="$1" runtime="$2" dir file
  dir="$(mktemp -d)"
  file="$dir/$APK_NAME"
  download "$file" "$url" || fail "The APK could not be downloaded from Expo ($url)."
  [ -s "$file" ] || fail "Expo's APK was empty ($url)."
  latest_json android "$runtime" "$dir/$LATEST_NAME"
  gh_cli release delete "$APK_TAG" --cleanup-tag --yes >/dev/null 2>&1 || true
  gh_cli release create "$APK_TAG" "$file" "$dir/$LATEST_NAME" --prerelease --target "${GITHUB_SHA:-main}" \
    --title "Companion app for Android (testing)" \
    --notes "The newest Android build of the companion app, for testers until it is in Google Play: $(git log -1 --format=%h 2>/dev/null || echo main). Install: open this file on the phone and allow installing from this source. Unofficial; not affiliated with any launch monitor maker." \
    || fail "The GitHub release $APK_TAG could not be made (log above)."
  rm -rf "$dir"
}

# A finished iPhone build: its runtime into latest.json of the pre-release (TestFlight brings the build itself).
ios_to_latest() {
  local dir
  dir="$(mktemp -d)"
  latest_json ios "$1" "$dir/$LATEST_NAME"
  if gh_cli release upload "$APK_TAG" "$dir/$LATEST_NAME" --clobber >/dev/null; then
    say "latest.json names the new iOS build: an iPhone with an older one is told to update in TestFlight."
  else
    warn "latest.json was not updated (no pre-release $APK_TAG yet: it comes with the first Android build)."
  fi
  rm -rf "$dir"
}

if [ "$command" = build ]; then
  for p in "${platforms[@]}"; do
    extra=()
    # The iPhone build goes to App Store Connect by itself, and from there to the internal testers.
    if [ "$p" = ios ]; then extra=(--auto-submit); fi
    wait_for=--no-wait
    if [ "$apk_release" = true ]; then wait_for=--wait; fi
    # shellcheck disable=SC2016 # a JavaScript template, not the shell's
    out="$(eas build --platform "$p" --profile "$(profile_of "$p")" --non-interactive "$wait_for" --json \
      ${extra[@]+"${extra[@]}"} --message "$message")" || fail "The $p build could not be started (log above)."
    # shellcheck disable=SC2016
    link="$(printf '%s' "$out" | json '`https://expo.dev/accounts/${j[0].app.ownerAccount.name}/projects/${j[0].app.slug}/builds/${j[0].id}`')" \
      || fail "The $p build could not be started (log above)."
    if [ "$p" = ios ] && [ "$wait_for" = --wait ]; then
      printf '%s' "$out" | json 'j[0].status === "FINISHED" ? "yes" : ""' >/dev/null \
        || fail "The iOS build did not finish ($link)."
      runtime="$(runtime_of "$out" ios)" || fail "The iOS build's runtime could not be worked out."
      ios_to_latest "$runtime"
      say "iOS build done; it goes to TestFlight by itself: $link"
    elif [ "$p" = ios ]; then
      say "iOS build started; it goes to TestFlight by itself when done: $link"
    elif [ "$wait_for" = --wait ]; then
      apk="$(printf '%s' "$out" | json 'j[0].status === "FINISHED" ? j[0].artifacts && j[0].artifacts.buildUrl : ""')" \
        || fail "The Android build did not finish ($link)."
      runtime="$(runtime_of "$out" android)" || fail "The Android build's runtime could not be worked out."
      apk_to_release "$apk" "$runtime"
      say "Android build (APK) done: $link - and on GitHub as the pre-release $APK_TAG ($APK_NAME, with $LATEST_NAME)."
    else
      say "Android build (APK) started, ready in about 15–25 minutes: $link"
    fi
  done
  exit 0
fi

# update: per platform the runtime this code needs, and whether a build of it exists (one still building counts).
to_update=()
for p in "${platforms[@]}"; do
  runtime="$(resolve_runtime "$p" | json 'j.runtimeVersion')" || fail "The runtime version ($p) could not be worked out."
  builds="$(eas build:list --platform "$p" --build-profile "$(profile_of "$p")" --runtime-version "$runtime" \
    --limit 20 --json --non-interactive)" || fail "Expo's list of builds ($p) could not be read."
  compatible="$(printf '%s' "$builds" \
    | json 'String(j.filter(b => !["ERRORED","CANCELED","PENDING_CANCEL"].includes(b.status)).length)')" \
    || fail "Expo's list of builds ($p) could not be read."
  if [ "$compatible" -gt 0 ]; then
    to_update+=("$p")
  else
    warn "$p: no build can run this code (runtime ${runtime:0:10}): a new build is needed." \
      "Start it by hand: Actions → Companion build → Run workflow ($p)."
  fi
done

if [ "${#to_update[@]}" -eq 0 ]; then
  say "Nothing published."
  exit 0
fi
if [ "${#to_update[@]}" -eq 2 ]; then target=all; else target="${to_update[0]}"; fi
eas update --channel "$channel" --environment "$channel" --platform "$target" --message "$message" --non-interactive \
  || fail "The update could not be published (log above)."
say "Update published for ${to_update[*]} (project ${project:0:8}…): “$message”. The app takes it when it is next opened."
