#!/usr/bin/env bash
# Starts a Claude session for reading an untrusted report (CLAUDE.md, "Untrusted input"):
# plan mode, so nothing is edited or run until you approve a plan, with .claude/triage.json's
# ask rules on top of the project's deny rules and Bash guard. Every push, gh write, download,
# install, web fetch and edit to Claude's instructions or memory prompts you.
#
#   bash .claude/triage.sh        # from anywhere in the repo, in a terminal
#
# Paste the checked copy from check_report.py into it, take its verdict back to your usual session,
# and fix from that session's own reproduction.

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel) || exit 1
bin=$(command -v claude || ls -d ~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)
if [ ! -x "$bin" ]; then
  echo "triage: no claude CLI found, on PATH or in the VS Code extension" >&2
  exit 1
fi
cd "$root" && exec "$bin" --permission-mode plan --settings "$root/.claude/triage.json" "$@"
