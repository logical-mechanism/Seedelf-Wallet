#!/usr/bin/env bash
# Proves the session model (session.spthy) with Tamarin 1.12.0, in the pinned container
# Dockerfile builds. The model has four configurations, chosen by flag:
#   (none)              the sessions: first contact, the ratchet, long-term keys and the
#                       initiator's state stolen, and their lemmas
#   -D=RESPONDER_STATE  the sessions with the responder's state stolen instead
#   -D=CONTINUATIONS    first contact and §6's continuations, and theirs
#   -D=NO_CID_RULE      the sessions without §5's cid rule: its one lemma must find a replay
# -D=CONTINUATIONS_UNFINISHED holds four lemmas that ran past an hour at 12 GB: not run here.
# Every lemma runs in its own memory-capped container, with its block's flag, PAR at a
# time. A [reuse] lemma is assumed by the lemmas after it and proved in its own run, so
# the whole is sound once every run reads "verified". Then one wellformedness run per
# configuration, with the message-derivation check given DERIV seconds (the lemma runs
# turn it off: 0 deactivates it in Tamarin, it isn't "no limit").
#   ./check.sh                    everything
#   ./check.sh m1_secret ...      some lemmas, by name
#   PAR=1 ./check.sh              one lemma at a time: about 12 GB and a core, not 36 GB
#   PAR=1 CAP=24g LIMIT=7200 ./check.sh responder_keys4_secret   one heavy lemma, more room
#   LOGS=/some/dir ./check.sh     keep every run's log there
# Exit status 0 only when every lemma reads verified and nothing warns. It's heavy: run it
# when the machine is otherwise idle (README).
cd "$(dirname "$0")" || exit 1
IMAGE=seedelf-messaging-tamarin:1.12.0
PAR=${PAR:-3}
CAP=${CAP:-12g}
LIMIT=${LIMIT:-3600}
DERIV=${DERIV:-1800}
MODEL=session.spthy

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE"
  docker build -q -t "$IMAGE" . >/dev/null || { echo "the image didn't build"; exit 1; }
fi

if [ -n "${LOGS:-}" ]; then
  out=$LOGS; mkdir -p "$out"
else
  out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
fi

# tamarin <log> <args...>: one run, killed at LIMIT seconds.
tamarin() {
  local log=$1; shift
  timeout --signal=KILL "$((LIMIT + 30))" docker run --rm -m "$CAP" --network none \
    -v "$PWD":/w:ro "$IMAGE" "$@" "/w/$MODEL" > "$log" 2>&1
}

# Each lemma with the flag of the #ifdef block it's in: "flag lemma" lines.
plan() {
  awk '/^#ifdef /{b=$0} /^#endif/{b=""}
       /^lemma /{f = (b ~ /^#ifdef CONTINUATIONS$/) ? "-D=CONTINUATIONS" : (b ~ /^#ifdef NO_CID_RULE$/) ? "-D=NO_CID_RULE" :
                     (b ~ /^#ifdef RESPONDER_STATE$/) ? "-D=RESPONDER_STATE" : "-";
                 n = $2; sub(/:$/, "", n); if (b !~ /^#ifdef CONTINUATIONS_UNFINISHED$/) print f, n}' "$MODEL"
}
if [ $# -gt 0 ]; then
  plan | grep -wFf <(printf '%s\n' "$@") > "$out/plan"
else
  plan > "$out/plan"
fi

one() {
  local flag=$1 L=$2 start=$SECONDS args=(--prove="$2" --derivcheck-timeout=0)
  [ "$flag" = - ] || args+=("$flag")
  tamarin "$out/$L.log" "${args[@]}"
  local result
  result=$(grep -oE "^  $L \((all|exists)-traces?\): [a-z ]+\([0-9]+ steps\)" "$out/$L.log")
  printf '%-52s %-17s %s  %ss\n' "$L" "${flag#-D=}" "${result#*: }" "$((SECONDS - start))"
  [ -n "$result" ] || echo "    no result: killed at ${LIMIT}s or over $CAP? see the log"
}
export -f one tamarin
export out IMAGE CAP LIMIT MODEL

xargs -P "$PAR" -L 1 bash -c 'one "$0" "$1"' < "$out/plan"

status=0
while read -r flag L; do
  grep -qE "^  $L \((all|exists)-traces?\): verified" "$out/$L.log" || { echo "NOT VERIFIED: $L"; status=1; }
done < "$out/plan"

if [ $# -eq 0 ]; then
  for flag in - -D=RESPONDER_STATE -D=CONTINUATIONS -D=NO_CID_RULE; do
    args=(--derivcheck-timeout="$DERIV"); [ "$flag" = - ] || args+=("$flag")
    LIMIT=$((DERIV + 600)) tamarin "$out/wellformed${flag/#-D=/-}.log" "${args[@]}"
  done
fi
for log in "$out"/*.log; do
  if grep -q "WARNING" "$log"; then
    echo "WARNING in $(basename "$log"):"; sed -n '/WARNING/,/^\*\//p' "$log" | head -40; status=1
  fi
done

if [ $status -eq 0 ]; then echo "ok: every lemma verified, nothing warns"; else echo "FAILED"; fi
exit $status
