#!/usr/bin/env bash
# Proves the session model (session.spthy) with Tamarin 1.12.0, in the pinned container
# Dockerfile builds. The model has six configurations, chosen by flag:
#   (none)              the sessions: first contact, the ratchet, long-term keys and the
#                       initiator's state stolen, and their lemmas
#   -D=RESPONDER_STATE  the sessions with the responder's state stolen instead
#   -D=CONTINUATIONS    first contact and §6's continuations, and theirs
#   -D=NO_CID_RULE      the sessions without §5's cid rule: its one lemma must find a replay
#   -D=REVEAL           first contact and §19's verified reveal, and its lemmas
#   -D=SKIPPED          the ratchet to a chain of two messages read in either order, and
#                       a kept skipped key stolen
# Every lemma runs in its own container, with its block's flag, PAR at a time. A [reuse]
# lemma is assumed by the lemmas after it and proved in its own run, so the whole is sound
# once every run reads "verified". Each configuration's wellformedness checks run in the
# same pool ("wellformed"), with the message-derivation check given DERIV seconds (the
# lemma runs turn it off: 0 deactivates it in Tamarin, it isn't "no limit").
#   ./check.sh                    everything
#   ./check.sh m1_secret ...      some lemmas, by name ("wellformed" for those checks)
#   PAR=1 ./check.sh              one run at a time: 8 GB and a core
#   PAR=1 CAP=12g LIMIT=7200 ./check.sh keys4_secret   one lemma, more room and time
#   LOGS=/some/dir ./check.sh     keep every run's log there
# Each run gets CAP of memory and no swap, and CPUS cores: Tamarin's runtime takes every
# core otherwise. Its heap is held to 90% of CAP less 256 MB, where GHC compacts the oldest
# generation in place instead of copying it, so a run fits more in the same CAP. Compacting
# is slow, so a run near its cap crawls rather than fails: a run with no result says why it
# stopped (out of time, heap overflow, or killed over CAP) and its peak live heap, from
# GHC's log of every collection, kept beside its log.
# A lemma that needs more says so on the line above it, "// check.sh: CAP=20g,LIMIT=9000,
# RTS=-c100" (RTS: GHC flags; -c100 copies, never compacts): those run first, as the
# longest. The defaults take at most 4 cores, and 32 GB, or 44 GB while the one 20 GB
# lemma runs.
# Exit status 0 only when every lemma reads verified and every run finished without a
# warning. It's heavy: run it when the machine is otherwise idle (README).
cd "$(dirname "$0")" || exit 1
IMAGE=seedelf-messaging-tamarin:1.12.0
PAR=${PAR:-4}
CAP=${CAP:-8g}
CPUS=${CPUS:-1}
LIMIT=${LIMIT:-3600}
DERIV=${DERIV:-1800}
MODEL=session.spthy

case $CAP in *g) ;; *) echo "CAP is in gigabytes, like 12g"; exit 1 ;; esac

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE"
  docker build -q -t "$IMAGE" . >/dev/null || { echo "the image didn't build"; exit 1; }
fi

if [ -n "${LOGS:-}" ]; then
  out=$LOGS; mkdir -p "$out"
else
  out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
fi

# heap <cap>: GHC's heap limit for a run of that cap.
heap() { echo "$(( ${1%g} * 1024 * 9 / 10 - 256 ))m"; }

# tamarin <limit> <log> <cap> <rts> <args...>: one run, stopped at <limit> seconds (TERM, then KILL a
# minute later). The timeout runs in the container: killing the docker client from outside
# would leave the container running. It runs as the caller, so its GC log (<log>.gc, in the
# writable /out) is the caller's to delete. Its status is timeout's: 124 out of time, else
# Tamarin's (251 GHC's heap overflow, 137 killed, by the kernel over CAP).
tamarin() {
  local limit=$1 log=$2 cap=$3 rts=$4; shift 4
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -m "$cap" --memory-swap "$cap" \
    --cpus "$CPUS" --network none -v "$PWD":/w:ro -v "$out":/out \
    --entrypoint timeout "$IMAGE" --signal=TERM --kill-after=60 "$limit" \
    tamarin-prover +RTS -N"$CPUS" -M"$(heap "$cap")" -A64m $rts -S"/out/$(basename "$log").gc" -RTS \
    --quiet "$@" "/w/$MODEL" > "$log" 2>&1
}

# why <status> <limit> <log> <cap>: why a run gave no result, and its peak live heap.
why() {
  local cause peak
  case $1 in
    124) cause="out of time at ${2}s" ;;
    251) cause="out of memory: GHC's heap overflowed $(heap "$4")" ;;
    137) cause="killed, most likely over $4" ;;
    *) cause="exit $1" ;;
  esac
  peak=$(awk '$1 ~ /^[0-9]+$/ && NF >= 9 { v = $3 + 0; if (v > m) m = v }
              END { printf "%.1f", m / 1073741824 }' "$3.gc" 2>/dev/null)
  echo "    no result: $cause; peak live heap ${peak:-?} GB of $(heap "$4"); see the log"
}

# Each lemma with the flag of the #ifdef block it's in and its own options ("-" for
# none), those with options first, then each configuration's wellformedness checks:
# "flag name options" lines.
plan() {
  awk '/^#ifdef /{b=$0} /^#endif/{b=""}
       /^\/\/ check\.sh: /{o=$3}
       /^lemma /{f = (b ~ /^#ifdef CONTINUATIONS$/) ? "-D=CONTINUATIONS" : (b ~ /^#ifdef NO_CID_RULE$/) ? "-D=NO_CID_RULE" :
                     (b ~ /^#ifdef RESPONDER_STATE$/) ? "-D=RESPONDER_STATE" : (b ~ /^#ifdef REVEAL$/) ? "-D=REVEAL" :
                     (b ~ /^#ifdef SKIPPED$/) ? "-D=SKIPPED" : "-";
                 n = $2; sub(/:$/, "", n); if (o != "") first = first f " " n " " o "\n"; else rest = rest f " " n " -\n"; o = ""}
       END {printf "%s%s", first, rest}' "$MODEL"
  printf '%s wellformed -\n' - -D=RESPONDER_STATE -D=CONTINUATIONS -D=NO_CID_RULE -D=REVEAL -D=SKIPPED
}
if [ $# -gt 0 ]; then
  plan | grep -wFf <(printf '%s\n' "$@") > "$out/plan"
else
  plan > "$out/plan"
fi

# logname <flag> <name>: a lemma's log is its name; a wellformedness run's, its flag's.
logname() {
  if [ "$2" = wellformed ] && [ "$1" != - ]; then echo "wellformed-${1#-D=}"; else echo "$2"; fi
}

one() {
  local flag=$1 L=$2 opts=${3:--} start=$SECONDS log limit=$LIMIT cap=$CAP rts= kv args result status
  log=$out/$(logname "$flag" "$L").log
  if [ "$opts" != - ]; then
    for kv in ${opts//,/ }; do
      case $kv in CAP=*g) cap=${kv#CAP=} ;; LIMIT=*) limit=${kv#LIMIT=} ;; RTS=*) rts=${kv#RTS=} ;; esac
    done
  fi
  if [ "$L" = wellformed ]; then
    args=(--derivcheck-timeout="$DERIV"); limit=$((DERIV + 600))
  else
    args=(--prove="$L" --derivcheck-timeout=0)
  fi
  [ "$flag" = - ] || args+=("$flag")
  tamarin "$limit" "$log" "$cap" "$rts" "${args[@]}"; status=$?
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" && result=finished
    grep -q "WARNING" "$log" && result="finished, warns"
  else
    result=$(grep -oE "^  $L \((all|exists)-traces?\): [a-z -]+\([0-9]+ steps\)" "$log")
    result=${result#*: }
  fi
  printf '%-52s %-17s %s  %ss\n' "$L" "${flag#-D=}" "$result" "$((SECONDS - start))"
  [ -n "$result" ] || why "$status" "$limit" "$log" "$cap"
}
export -f one tamarin logname why heap
export out IMAGE CAP CPUS LIMIT DERIV MODEL

xargs -P "$PAR" -L 1 bash -c 'one "$0" "$1" "$2"' < "$out/plan"

status=0
while read -r flag L _; do
  log=$out/$(logname "$flag" "$L").log
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" || { echo "DIDN'T FINISH: wellformed ${flag#-D=}"; status=1; }
  else
    grep -qE "^  $L \((all|exists)-traces?\): verified" "$log" || { echo "NOT VERIFIED: $L"; status=1; }
  fi
  if grep -q "WARNING" "$log"; then
    echo "WARNING in $(basename "$log"):"; sed -n '/WARNING/,/^\*\//p' "$log" | head -40; status=1
  fi
done < "$out/plan"

if [ $status -eq 0 ]; then echo "ok: every lemma verified, nothing warns"; else echo "FAILED"; fi
exit $status
