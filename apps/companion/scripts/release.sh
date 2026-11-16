#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
#
# Builds and updates of the companion app at Expo (EAS), for the GitHub workflows companion-build.yml
# (by hand) and companion-update.yml (every push to main that changes the app, once its tests passed).
#
#   bash apps/companion/scripts/release.sh update                    # an over-the-air update where a build can run it
#   bash apps/companion/scripts/release.sh build --platform android  # a new build: android, ios or all
#
# An update reaches only builds of the same runtime (the fingerprint of the native part). Where none
# exists - a new native module, an SDK upgrade - `update` says so and leaves the build to a person:
# builds start only by hand. Needs EXPO_TOKEN (a robot of the Expo organisation that owns the project)
# and the project id in app.config.ts; without them nothing happens, and the run's summary says why.
#
# EAS_CLI, EXPO_CONFIG, RESOLVE_RUNTIME and EAS_JSON can be swapped for stubs (scripts/release.test.ts).
set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck disable=SC2086 # the commands are meant to split into their words
eas() { ${EAS_CLI:-npx --yes eas-cli@27} "$@"; }
# shellcheck disable=SC2086
expo_config() { ${EXPO_CONFIG:-npx expo config --type public --json}; }
# shellcheck disable=SC2086
resolve_runtime() { ${RESOLVE_RUNTIME:-npx expo-updates runtimeversion:resolve --workflow managed} --platform "$1"; }

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
# Reads JSON from stdin and prints what the expression makes of `j`; fails on nothing or junk.
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{const j=JSON.parse(s.trim()||"null");v=('"$1"')}catch(e){console.error(String(e));process.exit(1)}if(v===undefined||v===null||v==="")process.exit(1);console.log(v)})'; }

channel=preview
profile_of() { if [ "$1" = ios ]; then echo testflight; else echo preview; fi; }

command="${1:-}"
if [ $# -gt 0 ]; then shift; fi
want=all
while [ $# -gt 0 ]; do
  case "$1" in
    --platform)
      [ $# -ge 2 ] || fail "--platform needs android, ios or all."
      want="$2"
      shift
      ;;
    *) fail "Unknown option: $1 (allowed: --platform android|ios|all)." ;;
  esac
  shift
done
case "$command" in update | build) ;; *) fail "Usage: release.sh update | build [--platform android|ios|all]" ;; esac
case "$want" in android | ios | all) ;; *) fail "--platform needs android, ios or all (not $want)." ;; esac

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
if [ "$want" != ios ]; then platforms+=(android); fi
if [ "$want" != android ]; then
  if [ "$ios_ready" = true ]; then
    platforms+=(ios)
  elif [ "$want" = ios ]; then
    fail "iOS isn't set up yet (eas.json: submit.testflight.ios.ascAppId is missing; apps/companion/README.md)."
  else
    say "iOS: not set up yet (no ascAppId in eas.json), Android only."
  fi
fi

message="$(git log -1 --format=%s 2>/dev/null || true)"
message="${message:-Companion app}"

if [ "$command" = build ]; then
  for p in "${platforms[@]}"; do
    extra=()
    # The iPhone build goes to App Store Connect by itself, and from there to the internal testers.
    if [ "$p" = ios ]; then extra=(--auto-submit); fi
    # shellcheck disable=SC2016 # a JavaScript template, not the shell's
    link="$(eas build --platform "$p" --profile "$(profile_of "$p")" --non-interactive --no-wait --json \
      ${extra[@]+"${extra[@]}"} --message "$message" \
      | json '`https://expo.dev/accounts/${j[0].app.ownerAccount.name}/projects/${j[0].app.slug}/builds/${j[0].id}`')" \
      || fail "The $p build could not be started (log above)."
    if [ "$p" = ios ]; then
      say "iOS build started; it goes to TestFlight by itself when done: $link"
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
