#!/usr/bin/env bash
# l8words#4: RELEASE.md's "Making a release" block, as HEAD has it, pasted on the
# version PR's branch (cli/0.9.0), against a local bare remote whose pre-receive
# hook stands in for main's ruleset (main moves only to a commit in approved.txt,
# i.e. one that passed *Web Wallet required*). Offline; nothing outside $SIM is
# touched. cargo update is stubbed (no crates here).
# Usage: sim-branch.sh <path to RELEASE.md> <sim dir>
set -u
RELEASE_MD=$1
SIM=$2
rm -rf "$SIM"; mkdir -p "$SIM"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=sim GIT_AUTHOR_EMAIL=sim@example.invalid
export GIT_COMMITTER_NAME=sim GIT_COMMITTER_EMAIL=sim@example.invalid
TREE=$(dirname "$RELEASE_MD")

start=$(grep -n "^## Making a release" "$RELEASE_MD" | head -1 | cut -d: -f1)
awk -v s="$start" 'NR>s && /^```bash$/ && !f {f=1; next} f && /^```$/ {exit} f {print}' "$RELEASE_MD" > "$SIM/block.sh"
sed -i 's/^cargo update .*/: cargo update skipped in the sim/' "$SIM/block.sh"
echo "== the block as extracted from $RELEASE_MD (cargo update stubbed)"; sed 's/^/   /' "$SIM/block.sh"

new_remote() { # $1 = case; $SIM/$1/{remote.git,seed}; main at M0 (0.8.0, tagged 0.8.0)
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
  git -C "$c/seed" commit -qm "M0: main at 0.8.0"
  git -C "$c/seed" tag 0.8.0
  git -C "$c/seed" rev-parse HEAD >> "$c/remote.git/approved.txt"
  git -C "$c/seed" remote add origin "$c/remote.git"
  git -C "$c/seed" push -q origin main 0.8.0
}

gh_merge() { # $1 = case, $2 = branch: GitHub merges the PR (a merge commit, check passed)
  local c=$SIM/$1
  git -C "$c/seed" pull -q --ff-only origin main
  git -C "$c/seed" fetch -q origin "$2"
  git -C "$c/seed" merge -q --no-ff FETCH_HEAD -m "Merge pull request #400 from logical-mechanism/$2"
  git -C "$c/seed" rev-parse HEAD >> "$c/remote.git/approved.txt"
  git -C "$c/seed" push -q origin main
}

gh_other_merge() { # $1 = case: another PR lands on GitHub's main first
  local c=$SIM/$1
  git -C "$c/seed" pull -q --ff-only origin main
  echo "later fix" > "$c/seed/LATER"
  git -C "$c/seed" add LATER
  git -C "$c/seed" commit -qm "M1: another PR's merge"
  git -C "$c/seed" rev-parse HEAD >> "$c/remote.git/approved.txt"
  git -C "$c/seed" push -q origin main
}

run() { # $1 = case, $2 = script file, $3 = version
  local c=$SIM/$1
  sed "s/^version=\".*\"/version=\"$3\"/" "$2" > "$c/run.sh"
  (cd "$c/work" && bash "$c/run.sh") 2>&1 | sed 's/^/    | /'
}

report() { # $1 = case, $2 = tag
  local r=$SIM/$1/remote.git
  local main tag
  main=$(git -C "$r" rev-parse main)
  echo "  remote branches: $(git -C "$r" for-each-ref --format='%(refname:short)' refs/heads | tr '\n' ' ')"
  if tag=$(git -C "$r" rev-parse -q --verify "refs/tags/$2^{commit}"); then
    echo "  remote: main=${main:0:8} ($(git -C "$r" log -1 --format=%s main)); tag $2=${tag:0:8} ($(git -C "$r" log -1 --format=%s "$tag"))"
    echo "  tag's Cargo.toml: $(git -C "$r" show "$tag:seedelf-platform/Cargo.toml" | grep -m1 '^version = ')"
    if [ "$tag" = "$main" ]; then echo "  => release.yml (on: push: tags '*.*.*') builds main's tip"
    elif git -C "$r" merge-base --is-ancestor "$tag" "$main"; then
      if [ "$(git -C "$r" rev-parse "$tag^{tree}")" = "$(git -C "$r" rev-parse "$main^{tree}")" ]; then t="the same tree as main's tip"; else t="NOT main's tip's tree"; fi
      echo "  => release.yml builds a commit main holds, but not main's tip ($t)"
    else echo "  => release.yml builds a commit main DOESN'T hold"; fi
  else
    echo "  remote: main=${main:0:8}, no tag $2 => release.yml doesn't run"
  fi
}

echo
echo "== F: the finding. Fresh main, branch cli/0.9.0, the block pasted there (version 0.9.0)"
new_remote F; git clone -q "$SIM/F/remote.git" "$SIM/F/work"
(cd "$SIM/F/work" && git switch -q main && git pull -q --ff-only && git switch -q -c cli/0.9.0)
run F "$SIM/block.sh" 0.9.0; report F 0.9.0

echo
echo "== F2: F, then the branch pushed, another PR lands, the version PR merges, and the page's"
echo "       post-merge step is followed: git switch main && git pull --ff-only, then the block"
(cd "$SIM/F/work" && git push -q -u origin cli/0.9.0)
gh_other_merge F; gh_merge F cli/0.9.0
(cd "$SIM/F/work" && git switch -q main && git pull -q --ff-only) 2>&1 | sed 's/^/    | /'
run F "$SIM/block.sh" 0.9.0; report F 0.9.0

# The fix sketch, as the finding gives it.
cat > "$SIM/fix1.sh" <<'B1'
version="0.9.0"
git switch main && git pull --ff-only && git switch -c cli/${version} && \
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-contracts/aiken.toml && \
sed -i '0,/^version = ".*"/s//version = "'${version}'"/' seedelf-platform/Cargo.toml && \
sed -i '0,/^seedelf-core = ".*"/s//seedelf-core = "'${version}'"/' seedelf-platform/Cargo.toml && \
sed -i '0,/^seedelf-crypto = ".*"/s//seedelf-crypto = "'${version}'"/' seedelf-platform/Cargo.toml && \
sed -i '0,/^seedelf-display = ".*"/s//seedelf-display = "'${version}'"/' seedelf-platform/Cargo.toml && \
sed -i '0,/^seedelf-koios = ".*"/s//seedelf-koios = "'${version}'"/' seedelf-platform/Cargo.toml && \
: cargo update skipped in the sim && \
git add seedelf-contracts/aiken.toml seedelf-platform/Cargo.toml seedelf-platform/Cargo.lock && \
git commit -m "chore: tagging ${version} release" && \
git push -u origin cli/${version}
B1
cat > "$SIM/fix2.sh" <<'B2'
version="0.9.0"
git switch main && git pull --ff-only && git tag ${version} && git push origin ${version}
B2
cat > "$SIM/fix2-guarded.sh" <<'B3'
version="0.9.0"
git switch main && git pull --ff-only && grep -m1 '^version = ' seedelf-platform/Cargo.toml | grep -qx "version = \"${version}\"" && git tag "${version}" && git push origin "${version}" || echo "STOP: no tag pushed (main doesn't hold ${version}, or a step above failed)"
B3
# fix2 pasted in a new terminal with block 1's line 1 missing: version unset
grep -v '^version=' "$SIM/fix2.sh" > "$SIM/fix2-noversion.sh"

echo
echo "== G: the fix sketch. Block 1 (branch, no tag), the PR merges, block 2 on main"
new_remote G; git clone -q "$SIM/G/remote.git" "$SIM/G/work"
run G "$SIM/fix1.sh" 0.9.0; echo "  -- after block 1:"; report G 0.9.0
gh_other_merge G; gh_merge G cli/0.9.0
run G "$SIM/fix2.sh" 0.9.0; echo "  -- after the merge and block 2:"; report G 0.9.0

echo
echo "== H: the fix sketch's block 2 pasted before the PR merges (block 1 done, PR open)"
new_remote H; git clone -q "$SIM/H/remote.git" "$SIM/H/work"
run H "$SIM/fix1.sh" 0.9.0 >/dev/null
run H "$SIM/fix2.sh" 0.9.0; report H 0.9.0

echo
echo "== H2: as H, with block 2 guarded on main's Cargo.toml holding the version"
new_remote H2; git clone -q "$SIM/H2/remote.git" "$SIM/H2/work"
run H2 "$SIM/fix1.sh" 0.9.0 >/dev/null
run H2 "$SIM/fix2-guarded.sh" 0.9.0; report H2 0.9.0
echo "  -- then the PR merges and the guarded block 2 is pasted again:"
gh_merge H2 cli/0.9.0
run H2 "$SIM/fix2-guarded.sh" 0.9.0; report H2 0.9.0

echo
echo "== J: the fix sketch's block 2 in a new terminal, without its own version line (version unset), after the merge"
new_remote J; git clone -q "$SIM/J/remote.git" "$SIM/J/work"
run J "$SIM/fix1.sh" 0.9.0 >/dev/null
gh_merge J cli/0.9.0
(cd "$SIM/J/work" && unset version && bash "$SIM/fix2-noversion.sh"; echo "exit $?") 2>&1 | sed 's/^/    | /'
report J 0.9.0
