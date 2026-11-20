#!/usr/bin/env bash
# Runs RELEASE.md's "Making a release" block, as HEAD has it, against a local
# bare remote whose pre-receive hook stands in for main's ruleset: main may
# move only to a commit that has passed *Web Wallet required* (approved.txt).
# Offline; nothing outside $SIM is touched. The block's cargo update line is a
# no-op here (the copy has no crates; on HEAD it changes nothing at 0.8.0,
# checked separately).
# Usage: sim.sh <path to RELEASE.md> <sim dir>
set -u
RELEASE_MD=$1
SIM=$2
rm -rf "$SIM"; mkdir -p "$SIM"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=sim GIT_AUTHOR_EMAIL=sim@example.invalid
export GIT_COMMITTER_NAME=sim GIT_COMMITTER_EMAIL=sim@example.invalid
TREE=$(dirname "$RELEASE_MD")

# The block's lines, fenced bash between "Change the version" and the fence's end.
start=$(grep -n '^Change the version' "$RELEASE_MD" | head -1 | cut -d: -f1)
awk -v s="$start" 'NR>s && /^```bash$/ && !f {f=1; next} f && /^```$/ {exit} f {print}' "$RELEASE_MD" > "$SIM/block.sh"
sed -i 's/^cargo update .*/: cargo update skipped in the sim/' "$SIM/block.sh"

new_remote() { # $1 = case name; prints nothing; makes $SIM/$1/{remote.git,seed}
  local c=$SIM/$1
  mkdir -p "$c"
  git init -q --bare --initial-branch=main "$c/remote.git"
  : > "$c/remote.git/approved.txt"
  cat > "$c/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
while read old new ref; do
  if [ "$ref" = "refs/heads/main" ] && ! grep -qx "$new" "$GIT_DIR/approved.txt"; then
    echo "error: GH013: Repository rule violations found for refs/heads/main." >&2
    echo "- Required status check \"Web Wallet required\" is expected." >&2
    exit 1
  fi
done
exit 0
HOOK
  chmod +x "$c/remote.git/hooks/pre-receive"
  git init -q -b main "$c/seed"
  mkdir -p "$c/seed/seedelf-contracts" "$c/seed/seedelf-platform"
  cp "$TREE/seedelf-contracts/aiken.toml" "$c/seed/seedelf-contracts/"
  cp "$TREE/seedelf-platform/Cargo.toml" "$TREE/seedelf-platform/Cargo.lock" "$c/seed/seedelf-platform/"
  git -C "$c/seed" add -A
  git -C "$c/seed" commit -qm "M0: main at 0.8.0 (the version PR's merge)"
  git -C "$c/seed" rev-parse HEAD >> "$c/remote.git/approved.txt"
  git -C "$c/seed" remote add origin "$c/remote.git"
  git -C "$c/seed" push -q origin main
}

advance_remote() { # $1 = case; a later merge lands on GitHub's main (approved)
  local c=$SIM/$1
  echo "later fix" > "$c/seed/LATER"
  git -C "$c/seed" add LATER
  git -C "$c/seed" commit -qm "M1: a later merge"
  git -C "$c/seed" rev-parse HEAD >> "$c/remote.git/approved.txt"
  git -C "$c/seed" push -q origin main
}

run_block() { # $1 = case, $2 = version, $3 = block file
  local c=$SIM/$1
  sed "s/^version=\".*\"/version=\"$2\"/" "$3" > "$c/run.sh"
  (cd "$c/work" && bash "$c/run.sh") 2>&1 | sed 's/^/    | /'
}

report() { # $1 = case, $2 = tag
  local r=$SIM/$1/remote.git
  local main tag
  main=$(git -C "$r" rev-parse main)
  if tag=$(git -C "$r" rev-parse -q --verify "refs/tags/$2^{commit}"); then
    echo "  remote: main=${main:0:8} tag $2=${tag:0:8} ($(git -C "$r" log -1 --format=%s "$tag"))"
    if [ "$tag" = "$main" ]; then echo "  => release.yml builds main's tip"
    elif git -C "$r" merge-base --is-ancestor "$tag" "$main"; then echo "  => release.yml builds a commit main holds, but not main's tip"
    else echo "  => release.yml builds a commit main DOESN'T hold"; fi
  else
    echo "  remote: main=${main:0:8}, no tag $2 => release.yml doesn't run"
  fi
}

echo "== A: fresh main (git switch main && git pull --ff-only), version 0.9.0 not on main yet"
new_remote A; git clone -q "$SIM/A/remote.git" "$SIM/A/work"
(cd "$SIM/A/work" && git switch -q main && git pull -q --ff-only)
run_block A 0.9.0 "$SIM/block.sh"; report A 0.9.0

echo "== B: as A, with the fix's chain: git push origin main && git tag && git push origin tag"
new_remote B; git clone -q "$SIM/B/remote.git" "$SIM/B/work"
(cd "$SIM/B/work" && git switch -q main && git pull -q --ff-only)
head -n -3 "$SIM/block.sh" > "$SIM/block-chained.sh"
echo 'git push origin main && git tag ${version} && git push origin ${version}' >> "$SIM/block-chained.sh"
run_block B 0.9.0 "$SIM/block-chained.sh"; report B 0.9.0

echo "== C: fresh main that already has the version (0.8.0, set by its PR)"
new_remote C; git clone -q "$SIM/C/remote.git" "$SIM/C/work"
(cd "$SIM/C/work" && git switch -q main && git pull -q --ff-only)
run_block C 0.8.0 "$SIM/block.sh"; report C 0.8.0

echo "== D: stale main that already has the version (no pull; GitHub's main moved on)"
new_remote D; git clone -q "$SIM/D/remote.git" "$SIM/D/work"; advance_remote D
run_block D 0.8.0 "$SIM/block.sh"; report D 0.8.0

echo "== E: stale main without the version (the sentence's own case)"
new_remote E; git clone -q "$SIM/E/remote.git" "$SIM/E/work"; advance_remote E
run_block E 0.9.0 "$SIM/block.sh"; report E 0.9.0
