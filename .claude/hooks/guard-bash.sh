#!/usr/bin/env bash
# PreToolUse guard for Claude's Bash calls (CLAUDE.md, "Untrusted input").
#
# Refuses a command that names a secret file, or one that could write to the
# guards themselves (.claude/settings*.json, .claude/hooks/, .claude/triage.*).
# Prints a deny decision as JSON, or nothing to let the command through.
#
# A tripwire, not a wall: it reads the command's text, so a command built to
# hide a path gets past it. The permission rules in .claude/settings.json and
# the owner's review are the gates. If this script fails, the hook's
# onFailure: block stops the command, so a broken or deleted guard is loud.

cmd=$(jq -r '.tool_input.command // empty') || exit 1
[ -n "$cmd" ] || exit 0

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput: {hookEventName: "PreToolUse",
    permissionDecision: "deny", permissionDecisionReason: $r}}'
  exit 0
}

l='(^|[^A-Za-z0-9_.-])' # a path part's left edge
r='($|[^A-Za-z0-9_.-])' # and its right edge

secrets="${l}\.env${r}"
secrets+="|${l}\.env\.([A-Za-z]+\.)?(local|mainnet|preprod|sancho|prod|production)${r}"
secrets+="|\.skey${r}"
secrets+="|${l}\.ssh(/|${r})|\.gnupg"
secrets+="|\.config/gh(/|${r})|gh[[:space:]]+auth[[:space:]]+token|--show-token"
secrets+="|\.cargo/credentials|\.npmrc|\.pgpass|\.netrc|\.git-credentials|\.docker/config\.json"
secrets+="|--export-secret"

if grep -Eq -- "$secrets" <<<"$cmd"; then
  deny "guard-bash: this command names a secret file (.env, *.skey, ~/.ssh, ~/.gnupg, a gh/cargo/npm token). Claude never reads these. If it's needed, the owner runs it."
fi

guards='\.claude/(settings[A-Za-z.]*\.json|hooks/|triage\.)'
writes='(^|[;&|({[:space:]])(rm|mv|cp|tee|truncate|chmod|chown|ln|dd|install|sponge|python3?|node|perl|ruby|git[[:space:]]+(checkout|restore|rm|mv|stash|reset|apply|clean))([[:space:]]|$)'
writes+='|sed[[:space:]][^|;&]*-[A-Za-z]*i|>>?[[:space:]]*[^&[:space:]]'

if grep -Eq -- "$guards" <<<"$cmd" && grep -Eq -- "$writes" <<<"$cmd"; then
  deny "guard-bash: this command could change Claude's guards (.claude/settings*.json, .claude/hooks/, .claude/triage.*). Those are the owner's to change, by hand."
fi

exit 0
