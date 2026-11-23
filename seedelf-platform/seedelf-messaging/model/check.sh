#!/usr/bin/env bash
# Proves the messaging models with Tamarin 1.12.0, in the pinned container Dockerfile
# builds. Three models, each with configurations chosen by flag (the README lists them):
#   session.spthy        the session layer: first contact, the ratchet, continuations, the
#                        reveal and skipped keys, with no outer envelope
#   envelope.spthy       the outer envelope: Phase 1's v1 alone, then first contact, the
#                        reply and skipped keys sealed in it, and the reader's outer check
#   unlinkability.spthy  the bare envelope's unlinkability, by observational equivalence
# Every lemma runs in its own container, with its block's flag, PAR at a time. A [reuse]
# lemma is assumed by the lemmas after it and proved in its own run, so the whole is sound
# once every run reads "verified". unlinkability.spthy's pairs of systems are named on its
# "// check.sh diff: <name> <flag> <result>" lines, each proved with --diff, and each must
# end in its result: its controls must be "falsified", finding the link they put in. Each
# configuration's wellformedness checks run in the same pool ("wellformed"), with the
# message-derivation check given DERIV seconds (the lemma runs turn it off: 0 deactivates
# it in Tamarin, it isn't "no limit").
#   ./check.sh                    everything
#   ./check.sh m1_secret ...      some lemmas, by name ("wellformed" for those checks)
#   MODELS=envelope.spthy ./check.sh   one model
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
# Exit status 0 only when every run reads as it must and finished without a warning. It's
# heavy: run it when the machine is otherwise idle (README).
cd "$(dirname "$0")" || exit 1
IMAGE=seedelf-messaging-tamarin:1.12.0
MODELS=${MODELS:-session.spthy envelope.spthy unlinkability.spthy}
PAR=${PAR:-4}
CAP=${CAP:-8g}
CPUS=${CPUS:-1}
LIMIT=${LIMIT:-3600}
DERIV=${DERIV:-1800}

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

# tamarin <model> <limit> <log> <cap> <rts> <args...>: one run, stopped at <limit> seconds
# (TERM, then KILL a minute later). The timeout runs in the container: killing the docker
# client from outside would leave the container running. It runs as the caller, so its GC
# log (<log>.gc, in the writable /out) is the caller's to delete. Its status is timeout's:
# 124 out of time, else Tamarin's (251 GHC's heap overflow, 137 killed, by the kernel over
# CAP).
tamarin() {
  local model=$1 limit=$2 log=$3 cap=$4 rts=$5; shift 5
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -m "$cap" --memory-swap "$cap" \
    --cpus "$CPUS" --network none -v "$PWD":/w:ro -v "$out":/out \
    --entrypoint timeout "$IMAGE" --signal=TERM --kill-after=60 "$limit" \
    tamarin-prover +RTS -N"$CPUS" -M"$(heap "$cap")" -A64m $rts -S"/out/$(basename "$log").gc" -RTS \
    --quiet "$@" "/w/$model" > "$log" 2>&1
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

# The plan, one run a line: "model flag name options expect". A lemma takes the flag of
# the #ifdef block it's in, when that block names one flag alone, and its own options ("-"
# for none); those with options go first. Then each model's pairs of systems, and each
# configuration's wellformedness checks: the model with no flag, and with each flag one of
# its #ifdef lines names alone.
plan() {
  local m
  for m in $MODELS; do
    awk -v m="$m" '/^#ifdef /{b=$0} /^#endif/{b=""}
         /^\/\/ check\.sh: /{o=$3}
         /^lemma /{f = (b ~ /^#ifdef [A-Z_]+$/) ? "-D=" substr(b, 8) : "-";
                   n = $2; sub(/:$/, "", n); l = m " " f " " n
                   if (o != "") print "1 " l " " o " -"; else print "2 " l " - -"; o = ""}
         /^\/\/ check\.sh diff: /{f = ($5 == "-") ? "-" : "-D=" $5; print "3 " m " " f " " $4 " diff " $6}' "$m"
  done | sort -s -n -k1,1 | cut -d' ' -f2-
  for m in $MODELS; do
    printf '%s - wellformed - -\n' "$m"
    awk '/^#ifdef [A-Z_]+$/{print $2}' "$m" | sort -u | while read -r f; do
      printf '%s -D=%s wellformed - -\n' "$m" "$f"
    done
  done
}
if [ $# -gt 0 ]; then
  plan | grep -wFf <(printf '%s\n' "$@") > "$out/plan"
else
  plan > "$out/plan"
fi

# logname <model> <flag> <name>: a lemma's log is its name; a wellformedness run's, its
# model's and its flag's.
logname() {
  if [ "$3" = wellformed ]; then
    local m=${1%.spthy}
    if [ "$2" = - ]; then echo "wellformed-$m"; else echo "wellformed-$m-${2#-D=}"; fi
  else
    echo "$3"
  fi
}

# isdiff <model>: whether the model's runs need --diff.
isdiff() { grep -q '^// check\.sh diff: ' "$1"; }

one() {
  local model=$1 flag=$2 L=$3 opts=${4:--} expect=${5:--} start=$SECONDS log limit=$LIMIT cap=$CAP rts= kv args result status
  log=$out/$(logname "$model" "$flag" "$L").log
  if [ "$opts" != - ] && [ "$opts" != diff ]; then
    for kv in ${opts//,/ }; do
      case $kv in CAP=*g) cap=${kv#CAP=} ;; LIMIT=*) limit=${kv#LIMIT=} ;; RTS=*) rts=${kv#RTS=} ;; esac
    done
  fi
  args=()
  isdiff "$model" && args+=(--diff)
  if [ "$L" = wellformed ]; then
    args+=(--derivcheck-timeout="$DERIV"); limit=$((DERIV + 600))
  elif [ "$opts" = diff ]; then
    args+=(--prove --derivcheck-timeout=0)
  else
    args+=(--prove="$L" --derivcheck-timeout=0)
  fi
  [ "$flag" = - ] || args+=("$flag")
  tamarin "$model" "$limit" "$log" "$cap" "$rts" "${args[@]}"; status=$?
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" && result=finished
    grep -q "WARNING" "$log" && result="finished, warns"
  elif [ "$opts" = diff ]; then
    result=$(grep -oE "DiffLemma: +Observational_equivalence : [a-z -]+\([0-9]+ steps\)" "$log" | head -1)
    result=${result##*equivalence : }
  else
    result=$(grep -oE "^  $L \((all|exists)-traces?\): [a-z -]+\([0-9]+ steps\)" "$log")
    result=${result#*: }
  fi
  printf '%-52s %-24s %s  %ss\n' "$L" "${model%.spthy} ${flag#-D=}" "$result" "$((SECONDS - start))"
  [ -n "$result" ] || why "$status" "$limit" "$log" "$cap"
}
export -f one tamarin logname why heap isdiff
export out IMAGE CAP CPUS LIMIT DERIV

xargs -P "$PAR" -L 1 bash -c 'one "$0" "$1" "$2" "$3" "$4"' < "$out/plan"

status=0
while read -r model flag L opts expect; do
  log=$out/$(logname "$model" "$flag" "$L").log
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" || { echo "DIDN'T FINISH: wellformed ${model%.spthy} ${flag#-D=}"; status=1; }
  elif [ "$opts" = diff ]; then
    grep -qE "DiffLemma: +Observational_equivalence : $expect" "$log" || { echo "NOT $expect: $L"; status=1; }
  else
    grep -qE "^  $L \((all|exists)-traces?\): verified" "$log" || { echo "NOT VERIFIED: $L"; status=1; }
  fi
  if grep -q "WARNING" "$log"; then
    echo "WARNING in $(basename "$log"):"; sed -n '/WARNING/,/^\*\//p' "$log" | head -40; status=1
  fi
done < "$out/plan"

if [ $status -eq 0 ]; then echo "ok: every run reads as it must, nothing warns"; else echo "FAILED"; fi
exit $status
