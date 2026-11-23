#!/usr/bin/env bash
# Proves the messaging models with Tamarin 1.12.0, in the pinned container Dockerfile
# builds. Three models, each with configurations chosen by flag (the README lists them):
#   session.spthy        the session layer: first contact, the ratchet, continuations, the
#                        reveal and skipped keys, with no outer envelope
#   envelope.spthy       the outer envelope: Phase 1's v1 alone, then first contact, the
#                        reply and skipped keys sealed in it, and the reader's checks of
#                        every point its key touches, each with a control that drops it
#   unlinkability.spthy  the bare envelope's unlinkability, and a reader's answers, by
#                        observational equivalence
# Every lemma runs in its own container, with its block's flag, PAR at a time. A [reuse]
# lemma is assumed by the lemmas after it and proved in its own run, so the whole is sound
# once every run reads "verified". unlinkability.spthy's pairs of systems are named on its
# "// check.sh diff: <name> <flag> <result> [<options>]" lines, each proved with --diff, and
# each must end in its result: its controls must be "falsified", finding the link they put
# in. Each configuration's wellformedness checks run in the same pool ("wellformed"), with
# the message-derivation check given DERIV seconds (the lemma runs turn it off: 0
# deactivates it in Tamarin, it isn't "no limit").
#   ./check.sh                    everything
#   ./check.sh m1_secret ...      some runs: each word a lemma's or a pair's name, a model
#                                 (session.spthy), a flag given bare (FIRST), or "wellformed"
#                                 for those checks; a word that names nothing stops it
#   MODELS=envelope.spthy ./check.sh   one model
#   PAR=1 ./check.sh              one run at a time: 8 GB and a core
#   PAR=1 CAP=12g LIMIT=7200 ./check.sh keys4_secret   one lemma, more room and time
#   LOGS=/some/dir ./check.sh     keep every run's log there, as <model>-<flag>-<name>.log
# Each run gets CAP of memory and no swap, and CPUS cores: Tamarin's runtime takes every
# core otherwise. Its heap is held to 90% of CAP less 256 MB, where GHC compacts the oldest
# generation in place instead of copying it, so a run fits more in the same CAP. Compacting
# is slow, so a run near its cap crawls rather than fails: a run with no result says why it
# stopped (out of time, heap overflow, or killed over CAP) and its peak live heap, from
# GHC's log of every collection, kept beside its log.
# A lemma that needs more says so on the line above it, "// check.sh: CAP=20g,LIMIT=9000,
# RTS=-c100" (RTS: GHC flags; -c100 copies, never compacts), and a pair in its line's last
# field: those lemmas run first, as the longest, and the pairs last. An option line raises
# CAP and LIMIT, never lowers what the caller asked for. The defaults take at most 4 cores
# and 32 GB, more while a run with its own CAP runs: 44 GB with the one 20 GB lemma, which
# runs first; the one 12 GB pair runs last.
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

if [ -n "${LOGS:-}" ]; then
  out=$LOGS; mkdir -p "$out"
else
  out=$(mktemp -d); trap 'rm -rf "$out"' EXIT
fi

# The plan, one run a line: "model flag name options expect". A lemma takes the flag of
# the #ifdef block it's in, when that block names one flag alone, and its own options ("-"
# for none); those with options go first. Then each model's pairs of systems, whose options
# are "diff" and the line's own, and each configuration's wellformedness checks: the model
# with no flag, and with each flag one of its #ifdef lines names alone.
plan() {
  local m
  for m in $MODELS; do
    awk -v m="$m" '/^#ifdef /{b=$0} /^#endif/{b=""}
         /^\/\/ check\.sh: /{o=$3}
         /^lemma /{f = (b ~ /^#ifdef [A-Z_]+$/) ? "-D=" substr(b, 8) : "-";
                   n = $2; sub(/:$/, "", n); l = m " " f " " n
                   if (o != "") print "1 " l " " o " -"; else print "2 " l " - -"; o = ""}
         /^\/\/ check\.sh diff: /{f = ($5 == "-") ? "-" : "-D=" $5; d = ($7 != "") ? "diff," $7 : "diff"
                                  print "3 " m " " f " " $4 " " d " " $6}' "$m"
  done | sort -s -n -k1,1 | cut -d' ' -f2-
  for m in $MODELS; do
    printf '%s - wellformed - -\n' "$m"
    awk '/^#ifdef [A-Z_]+$/{print $2}' "$m" | sort -u | while read -r f; do
      printf '%s -D=%s wellformed - -\n' "$m" "$f"
    done
  done
}

# select <word...>: the plan's runs that the words name, into $out/plan, or all of them.
# Every word must name a model, a flag or a run exactly: a misspelt name proves nothing.
select_runs() {
  local w
  if [ $# -gt 0 ]; then
    plan | grep -wFf <(printf '%s\n' "$@") > "$out/plan"
    for w in "$@"; do
      awk -v w="$w" '$1 == w || $2 == "-D=" w || $3 == w { f = 1 } END { exit !f }' "$out/plan" \
        || { echo "matches nothing: $w"; return 1; }
    done
  else
    plan > "$out/plan"
  fi
  [ -s "$out/plan" ] || { echo "nothing to run"; return 1; }
  echo "$(wc -l < "$out/plan") runs"
}
select_runs "$@" || exit 1

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE"
  docker build -q -t "$IMAGE" . >/dev/null || { echo "the image didn't build"; exit 1; }
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

# logname <model> <flag> <name>: a run's log is its model's, its flag's and its name, so two
# models' lemmas of one name never share a file.
logname() {
  local m=${1%.spthy}
  if [ "$2" = - ]; then echo "$m-$3"; else echo "$m-${2#-D=}-$3"; fi
}

# isdiff <model>: whether the model's runs need --diff.
isdiff() { grep -q '^// check\.sh diff: ' "$1"; }

# ispair <options>: whether a run is a pair of systems ("diff", or "diff," and its own).
ispair() { case $1 in diff | diff,*) return 0 ;; *) return 1 ;; esac; }

one() {
  local model=$1 flag=$2 L=$3 opts=${4:--} expect=${5:--} start=$SECONDS log limit=$LIMIT cap=$CAP rts= kv v own args result status
  log=$out/$(logname "$model" "$flag" "$L").log
  own=$opts
  if ispair "$opts"; then own=${opts#diff}; own=${own#,}; fi
  if [ -n "$own" ] && [ "$own" != - ]; then
    # A run's own line raises CAP and LIMIT; it never lowers what the caller asked for.
    for kv in ${own//,/ }; do
      case $kv in
        CAP=*g) v=${kv#CAP=}; [ "${v%g}" -gt "${cap%g}" ] && cap=$v ;;
        LIMIT=*) v=${kv#LIMIT=}; [ "$v" -gt "$limit" ] && limit=$v ;;
        RTS=*) rts=${kv#RTS=} ;;
      esac
    done
  fi
  args=()
  isdiff "$model" && args+=(--diff)
  if [ "$L" = wellformed ]; then
    args+=(--derivcheck-timeout="$DERIV"); limit=$((DERIV + 600))
  elif ispair "$opts"; then
    args+=(--prove --derivcheck-timeout=0)
  else
    args+=(--prove="$L" --derivcheck-timeout=0)
  fi
  [ "$flag" = - ] || args+=("$flag")
  tamarin "$model" "$limit" "$log" "$cap" "$rts" "${args[@]}"; status=$?
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" && result=finished
    grep -q "WARNING" "$log" && result="finished, warns"
  elif ispair "$opts"; then
    result=$(grep -oE "DiffLemma: +Observational_equivalence : [a-z -]+\([0-9]+ steps\)" "$log" | head -1)
    result=${result##*equivalence : }
  else
    result=$(grep -oE "^  $L \((all|exists)-traces?\): [a-z -]+\([0-9]+ steps\)" "$log")
    result=${result#*: }
  fi
  printf '%-52s %-24s %s  %ss\n' "$L" "${model%.spthy} ${flag#-D=}" "$result" "$((SECONDS - start))"
  [ -n "$result" ] || why "$status" "$limit" "$log" "$cap"
}
export -f one tamarin logname why heap isdiff ispair
export out IMAGE CAP CPUS LIMIT DERIV

xargs -r -P "$PAR" -L 1 bash -c 'one "$0" "$1" "$2" "$3" "$4"' < "$out/plan"

status=0
while read -r model flag L opts expect; do
  log=$out/$(logname "$model" "$flag" "$L").log
  if [ "$L" = wellformed ]; then
    grep -q "summary of summaries" "$log" || { echo "DIDN'T FINISH: wellformed ${model%.spthy} ${flag#-D=}"; status=1; }
  elif ispair "$opts"; then
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
