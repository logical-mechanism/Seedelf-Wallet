#!/usr/bin/env python3
"""Check an untrusted report (a PDF, an email, HTML or pasted text) before it goes to Claude.

Shows what a reader like Claude would get from the input that a person looking at it wouldn't see:
hidden PDF and HTML text, invisible or lookalike characters, text aimed at an AI, commands, odd links.
Writes a checked copy with every hidden part marked ⟦like this⟧, so the owner and Claude read the same
thing. Paste that copy, not the original.

    python3 -I .claude/tools/check_report.py report.pdf
    python3 -I .claude/tools/check_report.py message.eml      # Gmail: ⋮ > Download message
    python3 -I .claude/tools/check_report.py -                # paste, then Ctrl-D on an empty line

-I keeps Python from importing anything that sits beside the input. Exit status: 0 nothing found
(or only weak signals), 1 findings to read, 2 the input couldn't be checked.

It only reads: nothing in the input is run, fetched or opened. The PDF tools it calls (poppler's
pdfinfo, pdftotext, pdftoppm and pdfdetach, MuPDF's mutool) do parse the file, and a parser can have
bugs, so for a PDF from someone you have reason to distrust, run this in a throwaway container.

A heuristic, not a proof. A clean result means none of these tricks were found, not that the text is
safe: it's still a stranger's words, and its suggested fix is never applied as written.
"""

import argparse
import base64
import binascii
import collections
import difflib
import email
import email.policy
import html
import html.parser
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.parse

MAX_BYTES = 50 * 1024 * 1024
TOOL_TIMEOUT = 180
MAX_RENDER_PAGES = 100
LIST_LIMIT = 25
OPEN, CLOSE = "⟦", "⟧"  # ⟦ ⟧: only this script writes them into the checked copy
MARKER = re.compile(f"{OPEN}[^{CLOSE}]*{CLOSE}")

SECTIONS = [
    ("hidden", "Hidden text: a reader gets it, a person looking doesn't see it"),
    ("chars", "Invisible, control or lookalike characters"),
    ("ai", "Text aimed at an AI, or asking for secrets or shortcuts"),
    ("command", "Commands and code (never run them from a report)"),
    ("active", "Attachments, scripts, forms and mail headers"),
    ("links", "Links worth a look"),
    ("encoded", "Encoded blobs"),
]


class ToolError(Exception):
    pass


class Report:
    def __init__(self):
        self.items = collections.defaultdict(list)
        self.seen = set()
        self.notes = []
        self.domains = collections.Counter()
        self.addresses = {}
        self.fake_markers = False

    def add(self, kind, where, detail, weak=False):
        key = (kind, where, detail)
        if key not in self.seen:
            self.seen.add(key)
            self.items[kind].append((where, detail, weak))

    def src(self, text):
        """Every piece of input passes through here, so ⟦ ⟧ in the checked copy are always the script's own."""
        if OPEN in text or CLOSE in text:
            if not self.fake_markers:
                self.fake_markers = True
                self.add("chars", "input", "contains ⟦ or ⟧, the characters this script marks with (a fake marker?); shown as [[ ]]")
            text = text.replace(OPEN, "[[").replace(CLOSE, "]]")
        return text


def mark(label, text=""):
    text = re.sub(r"[ \t\r\n]+", " ", text).strip()
    return f"{OPEN}{label}: {text}{CLOSE}" if text else f"{OPEN}{label}{CLOSE}"


def clip(text, n=200):
    text = re.sub(r"[ \t\r\n]+", " ", text).strip()
    return '"' + (text if len(text) <= n else text[: n - 1] + "…") + '"'


def snippet(line, start, end, width=70):
    a, b = max(0, start - width), min(len(line), end + width)
    return '"' + ("…" if a else "") + line[a:b].strip() + ("…" if b < len(line) else "") + '"'


def printable(text):
    """Decoded hidden data, safe to show: no control or marker characters."""
    return "".join(c if c.isprintable() and c not in (OPEN, CLOSE) else "?" for c in text)


# ---------------------------------------------------------------- characters

BIDI = {0x061C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)}
BLANK = {0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800, 0x180E}  # letters and symbols that render as nothing
CONFUSABLE_SCRIPTS = {"CYRILLIC", "GREEK", "ARMENIAN", "CHEROKEE", "COPTIC", "LISU", "VAI", "OSAGE", "GEORGIAN"}
WORD = re.compile(r"[^\W\d_]{2,}")


def is_tag(cp):
    return 0xE0000 <= cp <= 0xE007F


def is_vs(cp):
    return 0xFE00 <= cp <= 0xFE0F or 0xE0100 <= cp <= 0xE01EF


def is_pictographic(ch):
    return bool(ch) and (unicodedata.category(ch) == "So" or 0x1F000 <= ord(ch) <= 0x1FAFF)


def char_name(cp):
    name = unicodedata.name(chr(cp), "")
    return f"U+{cp:04X}" + (f" {name}" if name else "")


def odd(ch, prev, nxt):
    """Why one character is worth showing, or None."""
    cp = ord(ch)
    if ch in "\t\n" or 0x20 <= cp < 0x7F:
        return None
    if cp == 0x200D and (is_pictographic(prev) or is_pictographic(nxt)):
        return None  # an emoji sequence
    if cp == 0x1B:
        return "terminal escape"
    if cp in BIDI:
        return "bidi control: the text can display in a different order than it's stored"
    if cp in BLANK:
        return "renders as nothing"
    if cp in (0x2028, 0x2029):
        return "line break some readers see and others don't"
    category = unicodedata.category(ch)
    if category == "Cc":
        return "control character"
    if category == "Cf":
        return "invisible format character"
    if category == "Co":
        return "private-use character"
    if category == "Cn":
        return "unassigned code point"
    return None


def mark_chars(line):
    """The line with odd characters marked, the line without them, and what was found."""
    out, plain, found, payloads = [], [], [], []
    i, n = 0, len(line)
    while i < n:
        ch, cp = line[i], ord(line[i])
        if is_tag(cp) or is_vs(cp):
            test = is_tag if is_tag(cp) else is_vs
            j = i
            while j < n and test(ord(line[j])):
                j += 1
            run = line[i:j]
            if is_tag(cp):
                flag = i > 0 and ord(line[i - 1]) == 0x1F3F4 and ord(run[-1]) == 0xE007F and len(run) <= 7
                decoded = "".join(chr(ord(c) - 0xE0000) for c in run if 0xE0020 <= ord(c) <= 0xE007E)
                label, count = "hidden tag text", "tag characters"
            else:
                flag = len(run) == 1  # one selector picks an emoji or glyph style; a run carries data
                data = bytes(c - 0xFE00 if c <= 0xFE0F else c - 0xE0100 + 16 for c in map(ord, run))
                decoded = printable(data.decode("utf-8", "replace"))
                label, count = "hidden variation-selector data", "variation selectors"
            if flag:
                out.append(run)
                plain.append(run)
            else:
                found.append(f"{len(run)} {count}" + (f', decoded: "{decoded}"' if decoded else ""))
                out.append(mark(label, decoded))
                payloads.append(decoded)
            i = j
            continue
        why = odd(ch, line[i - 1] if i else "", line[i + 1] if i + 1 < n else "")
        if why:
            j = i
            while j < n and line[j] == ch:
                j += 1
            found.append((cp, why, j - i))
            out.append(mark(char_name(cp) + (f" ×{j - i}" if j - i > 1 else "")))
            i = j
            continue
        out.append(ch)
        plain.append(ch)
        i += 1
    return "".join(out), "".join(plain), found, payloads


def describe_chars(found):
    counts = collections.Counter()
    parts = []
    for f in found:
        if isinstance(f, str):
            parts.append(f)
        else:
            counts[f[:2]] += f[2]
    for (cp, why), count in counts.items():
        parts.append(f"{char_name(cp)}" + (f" ×{count}" if count > 1 else "") + f" ({why})")
    weak = all(not isinstance(f, str) and f[0] == 0xAD for f in found)  # soft hyphens only
    return "; ".join(parts), weak


def lookalike(word):
    scripts = {unicodedata.name(c, "?").split()[0] for c in word}
    if "LATIN" in scripts and scripts & CONFUSABLE_SCRIPTS:
        return "letters from " + " and ".join(sorted(scripts)) + " mixed in one word"
    folded = unicodedata.normalize("NFKC", word)
    if folded != word and folded.isascii() and not all("LIGATURE" in unicodedata.name(c, "") for c in word if not c.isascii()):
        return f'styled letters that read as "{folded}"'
    return None


# ------------------------------------------------------------------ patterns

AI_PATTERNS = [
    (r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}?\b(previous|prior|above|earlier|preceding|all|any|your|other|"
     r"original|system)\b.{0,30}?\b(instructions?|prompts?|rules|guidelines|directions|directives|messages|context|guardrails)\b",
     "tells the reader to drop its instructions", False),
    (r"\b(you are|you're|act as|acting as|pretend (to be|you are)|role-?play as|as an?)\s+(now\s+)?(an?\s+)?(ai|a\.i\.|"
     r"assistant|language model|llm|chat ?bot|agent|claude|chatgpt|gpt|copilot|gemini|codex)\b", "speaks to an AI", False),
    (r"\b(note|message|instructions?|reminder|directive)s?\s+(to|for)\s+(the\s+|any\s+)?(ai|assistant|model|llm|agent|bot|"
     r"claude|chatgpt|reviewer)s?\b", "a note to an AI", False),
    (r"\b(if|when)\s+you\s+(are|'re)\s+(an?\s+)?(ai|llm|assistant|language model|bot|agent|summari[sz]ing|reviewing|"
     r"analy[sz]ing|reading this)\b", "speaks to an AI", False),
    (r"<\|?\s*/?\s*(system|assistant|user|human|im_start|im_end|endoftext|instructions?|tool_call|function_call)\s*\|?>|"
     r"\[/?(inst|sys)\]|^\s*(system|assistant|human)\s*:", "chat-format markers (fake conversation turns)", False),
    (r"\b(do not|don't|never|without)\s+(tell(ing)?|inform(ing)?|mention(ing)?|alert(ing)?|notify(ing)?|show(ing)?|"
     r"reveal(ing)?|ask(ing)?|warn(ing)?|bother(ing)?)\b.{0,30}?\b(the\s+)?(user|owner|human|developer|maintainer|operator|"
     r"reviewer|them|anyone)\b", "asks to keep something from the owner", False),
    (r"\b(print|show|send|share|paste|include|reveal|output|dump|upload|post|e-?mail|give|attach|leak|exfiltrate|forward)\b"
     r".{0,40}?(\.env\b|api[_ -]?(keys?|tokens?)|(access|auth|bearer|github|gh|npm|crates?(\.io)?|api|session) tokens?|"
     r"credentials?|passwords?|\.skey|ssh keys?|gpg keys?|signing keys?|hosts\.yml|credentials\.toml|"
     r"environment variables)", "asks for secrets", False),
    (r"\b(print|show|send|share|paste|include|reveal|output|dump|upload|post|e-?mail|give|attach|leak|forward|type|enter)\b"
     r".{0,40}?\b(seed phrases?|mnemonics?|recovery phrases?|private keys?|secret keys?)\b",
     "asks for a wallet secret", True),
    (r"\b(push|commit|merge|deploy|publish|release|ship)\b.{0,30}?\b(directly|straight|right away|immediately|without review)\b|"
     r"\b(directly|straight)\s+(in)?to\s+(main|master|production|prod)\b", "asks to ship without the usual steps", False),
    (r"\b(skip|bypass|disable|turn off|switch off|ignore|remove)\b.{0,20}?\b(the\s+)?(review|reviews|tests?|ci|checks?|"
     r"verification|approval|guard|hooks?|signing|sandbox|permission|validation|torsion check|is_payable)\b",
     "asks to skip or remove a check", False),
    (r"\b(approve|grant|allow|enable|give yourself)\b.{0,20}?\b(all|every|any|full|unrestricted)\b.{0,20}?\b(permissions?|"
     r"tools?|commands?|access)\b|bypass ?permissions|dangerously[-_ ]?skip", "asks for more permissions", False),
    (r"\b(remember|from now on|going forward|in (all )?future (sessions|conversations|chats))\b.{0,40}?\b(memory|memories|"
     r"claude\.md|instructions?|rules?|preferences?|always)\b", "asks to change memory or standing instructions", False),
    (r"(claude\.md|\.claude/|settings(\.local)?\.json|memory\.md|agents\.md|\.cursorrules|copilot-instructions|\.mcp\.json)",
     "names an AI-instruction file", False),
    (r"\b(add|change|replace|update|swap|set|use)\b.{0,40}?\b(address|script hash|policy id|pubkey|public key|reference utxo|"
     r"payout|recipient|fee address|donation address|treasury)\b", "asks to change an address or hash", True),
    (r"\b(system prompt|system message|developer message|hidden instructions?|secret instructions?|prompt injection|jailbreak)\b",
     "talks about prompts", True),
    (r"\b(claude|chatgpt|gpt-?\d[\w.-]*|openai|anthropic|llms?|large language model|ai assistant|ai agent|coding agent|"
     r"copilot|codex)\b", "names an AI or AI tool", True),
]

COMMAND_PATTERNS = [
    (r"\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(ba|z)?sh\s+(-c\s+)?[\"']?\$?\(\s*(curl|wget)|\bsource\s+<\(",
     "runs a download", False),
    (r"\bbase64\s+(-d|--decode|-D)\b|\bfrom_?base64\b|\batob\s*\(|\bxxd\s+-r\b", "decodes hidden data", False),
    (r"\bpowershell(\.exe)?\b.*\s-(e|enc|encodedcommand)\b|\biex\b|invoke-expression", "encoded PowerShell", False),
    (r"\b(npm|pnpm|yarn|bun)\s+(i|install|add)\s+(-\S+\s+)*[@\w]", "installs an npm package", False),
    (r"\b(npx|pnpx|bunx)\s+(-\S+\s+)*[@\w]", "runs an npm package", False),
    (r"\bpip3?\s+install\s+(-\S+\s+)*\w|\buv\s+(pip\s+install|add)\b|\bpipx\s+(install|run)\b", "installs a Python package", False),
    (r"\bcargo\s+(add|install)\s+(-\S+\s+)*\w", "adds a crate", False),
    (r"\bgit\s+(push|remote\s+(add|set-url)|config|am|apply)\b|\s--(force|no-verify)\b", "git push, remote, config or patch", False),
    (r"\bsudo\b|\bchmod\s+(\+x|[0-7]*7[0-7]*)\b|\brm\s+-[a-z]*r[a-z]*\b|\bdd\s+if=", "privileged or destructive", False),
    (r"\b(ssh|scp|sftp|nc|ncat|netcat|socat|telnet)\s+(-\S+\s+)*[\w@.\[]", "remote connection", False),
    (r"\bdocker\s+run\b.*(--privileged|-v\s*/:|--volume[= ]/:|--net(work)?[= ]host|--pid[= ]host)", "privileged container", False),
    (r"\b(cat|less|more|head|tail|cp|scp|tar|zip|base64|xxd|curl)\b.*(\.env\b|~/\.ssh|\.gnupg|\.config/gh|credentials|\.skey)",
     "touches secret files", False),
    (r"\bcrontab\b|\bsystemctl\s+--user\s+(enable|start)|\.bashrc|\.zshrc|\.profile\b|/etc/profile|\bautostart\b",
     "persistence (runs again later)", False),
    (r"\b(eval|exec)\s*\(|\bpython3?\s+-c\b|\bnode\s+-e\b|\bperl\s+-e\b", "runs inline code", True),
]

AI_RES = [(re.compile(p, re.I), label, weak) for p, label, weak in AI_PATTERNS]
COMMAND_RES = [(re.compile(p, re.I), label, weak) for p, label, weak in COMMAND_PATTERNS]
URL_RE = re.compile(r"\b(?:https?|ftp|file|javascript|data|vbscript):[^\s<>\"'`]+", re.I)
ADDR_RE = re.compile(r"\b(?:addr|addr_test|stake|stake_test)1[02-9ac-hj-np-z]{20,}")
B64_RE = re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{100,}={0,2}")
SHORTENERS = {"bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "ow.ly", "buff.ly", "rebrand.ly", "cutt.ly",
              "shorturl.at", "t.ly", "rb.gy", "tiny.cc", "s.id", "v.gd", "lnkd.in"}


def url_flags(url):
    try:
        parts = urllib.parse.urlsplit(url.rstrip(".,;:!?)]}"))
    except ValueError:
        return "", ["unparseable link"]
    flags, scheme = [], parts.scheme.lower()
    if scheme in ("javascript", "data", "file", "vbscript"):
        flags.append(f"{scheme}: link")
    host = (parts.hostname or "").lower()
    if "@" in parts.netloc:
        flags.append("has user@ before the host: the real host is after the @")
    if "xn--" in host:
        try:
            flags.append(f'punycode host, shows as "{host.encode().decode("idna")}"')
        except UnicodeError:
            flags.append("punycode host")
    if host and not host.isascii():
        flags.append("non-ASCII host")
    try:
        ipaddress.ip_address(host.strip("[]"))
        flags.append("bare IP address")
    except ValueError:
        pass
    if host.removeprefix("www.") in SHORTENERS:
        flags.append("link shortener: the destination is hidden")
    return host, flags


def add_url(report, url, where):
    host, flags = url_flags(url)
    if host:
        report.domains[host] += 1
    if flags:
        report.add("links", where, f"{clip(url, 120)}: {', '.join(flags)}")


def scan_line(report, where, text):
    for kind, patterns in (("ai", AI_RES), ("command", COMMAND_RES)):
        for rx, label, weak in patterns:
            m = rx.search(text)
            if m:
                report.add(kind, where, f"{label}: {snippet(text, m.start(), m.end())}", weak)
    for url in URL_RE.findall(text):
        add_url(report, url, where)
    for addr in ADDR_RE.findall(text):
        report.addresses.setdefault(addr, where)
    for blob in B64_RE.findall(text):
        if re.fullmatch(r"[0-9a-fA-F]+", blob):
            continue
        try:
            data = base64.b64decode(blob + "=" * (-len(blob) % 4))
        except (binascii.Error, ValueError):
            continue
        decoded = data.decode("utf-8", "replace")
        share = sum(c.isprintable() or c.isspace() for c in decoded) / max(1, len(decoded))
        if share > 0.9:
            report.add("encoded", where, f"{len(blob)} base64 characters that decode to text: {clip(printable(decoded), 160)}")
        else:
            report.add("encoded", where, f"{len(blob)} base64 characters (binary once decoded)", True)


def finish(report, lines, strip):
    """Marks odd characters, scans every line, returns the checked copy. Line numbers survive both modes."""
    out = []
    for no, line in enumerate(lines, 1):
        marked, plain, found, payloads = mark_chars(line)
        where = f"line {no}"
        if found:
            detail, weak = describe_chars(found)
            report.add("chars", where, detail, weak)
        for word in WORD.findall(plain):
            why = lookalike(word)
            if why:
                report.add("chars", where, f'"{word}": {why}')
        text = re.sub(f"{OPEN}[^{CLOSE}:]*{CLOSE}", " ", plain)  # labels like ⟦page 2⟧
        text = re.sub(f"{OPEN}[^{CLOSE}]*?: |{CLOSE}", " ", text)  # ⟦label: text⟧ keeps the text
        scan_line(report, where, " ".join([unicodedata.normalize("NFKC", text), *payloads]))
        out.append(MARKER.sub("", plain).rstrip() if strip else marked.rstrip())
    return "\n".join(out).rstrip("\n") + "\n"


# ----------------------------------------------------------------------- PDF

MUPDF_SCRIPT = r"""
var doc = Document.openDocument(scriptArgs[0]);
var n = doc.countPages(), out = [];
for (var i = 0; i < n; i++) {
  var page = doc.loadPage(i), rec = {page: i + 1, normal: page.toStructuredText().asText(), annots: []};
  if (page.getAnnotations) {
    var an = page.getAnnotations();
    for (var k = 0; k < an.length; k++) rec.annots.push({type: an[k].getType(), contents: an[k].getContents() || ""});
  }
  out.push(rec);
}
if (typeof doc.findPage === "function") {
  for (var i = 0; i < n; i++) {
    var p = doc.findPage(i);
    p.put("MediaBox", [-20000, -20000, 20000, 20000]);
    p.put("CropBox", [-20000, -20000, 20000, 20000]);
    out[i].big = doc.loadPage(i).toStructuredText().asText();
  }
}
for (var i = 0; i < n; i++) print(JSON.stringify(out[i]));
"""

PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', re.S)
BLOCK_RE = re.compile(r"<block\b[^>]*>(.*?)</block>", re.S)
LINE_RE = re.compile(r"<line\b[^>]*>(.*?)</line>", re.S)
WORD_RE = re.compile(r'<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">(.*?)</word>', re.S)


def run(cmd, binary=False):
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=TOOL_TIMEOUT, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        raise ToolError(f"{cmd[0]} took over {TOOL_TIMEOUT} s")
    if r.returncode != 0:
        raise ToolError(f"{cmd[0]} failed: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def soft(report, cmd, what):
    """An optional step: if its tool fails, say what wasn't checked and go on."""
    try:
        return run(cmd)
    except ToolError as e:
        report.notes.append(f"{what} wasn't checked ({e})")
        return ""


def read_ppm(path):
    with open(path, "rb") as f:
        data = f.read()
    m = re.match(rb"P6\s+(\d+)\s+(\d+)\s+255\s", data)
    if not m:
        raise ToolError("pdftoppm wrote an image this script can't read")
    return int(m.group(1)), int(m.group(2)), data[m.end():]


def contrast(image, box, scale):
    w, h, px = image
    x0, x1 = max(0, int(box[0] * scale)), min(w, int(box[2] * scale + 0.999))
    y0, y1 = max(0, int(box[1] * scale)), min(h, int(box[3] * scale + 0.999))
    if x1 <= x0 or y1 <= y0:
        return 0
    lo, hi = 255, 0
    for y in range(y0, y1):
        row = px[(y * w + x0) * 3 : (y * w + x1) * 3]
        lo, hi = min(lo, min(row)), max(hi, max(row))
    return hi - lo


def word_reason(box, width, height, image, scale):
    x0, y0, x1, y1 = box
    if x1 <= 0 or y1 <= 0 or x0 >= width or y0 >= height:
        return "outside the page"
    if y1 - y0 < 3.0:
        return "tiny text under 3 pt"
    if image and contrast(image, box, scale) < 40:
        return "no ink on the page (white, invisible, covered or clipped)"
    return None


def extra_runs(more, base, least=2):
    """Runs of words in `more` that aren't in `base`, in order: text outside the page, or only in one part."""
    key = lambda t: unicodedata.normalize("NFKC", t).casefold().strip(".,;:!?\"'()[]<>")
    words = more.split()
    matcher = difflib.SequenceMatcher(None, [key(t) for t in base.split()], [key(t) for t in words], autojunk=False)
    runs = [words[j1:j2] for op, _, _, j1, j2 in matcher.get_opcodes() if op in ("insert", "replace")]
    return [" ".join(r) for r in runs if len(r) >= least]


def check_pdf(path, report, label, render, tmp):
    for tool in ("pdfinfo", "pdftotext"):
        if not shutil.which(tool):
            raise ToolError(f"{tool} isn't installed (poppler-utils)")
    lines = []
    info = {}
    for row in run(["pdfinfo", path]).splitlines():
        key, _, value = row.partition(":")
        info[key.strip()] = value.strip()
    pages = int(info.get("Pages", "0") or 0)
    if info.get("JavaScript") == "yes":
        report.add("active", label, "the PDF contains JavaScript")
    if info.get("Form", "none") != "none":
        report.add("active", label, f"the PDF has a form ({info['Form']}): field values aren't checked", True)
    meta = [f"{k}: {report.src(info[k])}" for k in ("Title", "Subject", "Keywords", "Author") if info.get(k)]
    if info.get("Metadata Stream") == "yes":
        xmp = soft(report, ["pdfinfo", "-meta", path], "XMP metadata")
        words = [t.strip() for t in re.sub(r"<[^>]+>", "\n", xmp).splitlines() if len(t.split()) >= 3]
        if words:
            meta.append("XMP: " + report.src(" / ".join(words)))
    if meta:
        lines.append(mark("PDF metadata, not shown on the pages", " | ".join(meta)))
    for row in soft(report, ["pdfinfo", "-url", path], "links").splitlines()[1:]:
        cols = row.split(None, 2)
        if len(cols) == 3:
            add_url(report, cols[2], f"{label} page {cols[0]} link")
    if shutil.which("pdfdetach"):
        for row in soft(report, ["pdfdetach", "-list", path], "embedded files").splitlines()[1:]:
            report.add("active", label, f"embedded file {clip(report.src(row.partition(':')[2].strip()), 80)}")

    mupdf = {}
    if shutil.which("mutool"):
        script = os.path.join(tmp, "pages.js")
        with open(script, "w") as f:
            f.write(MUPDF_SCRIPT)
        for row in soft(report, ["mutool", "run", script, path], "text outside the page and annotations").splitlines():
            if row.startswith("{"):
                rec = json.loads(row)
                mupdf[rec["page"]] = rec
    else:
        report.notes.append("mutool isn't installed: text outside the page and comment annotations weren't checked")
    if render and not shutil.which("pdftoppm"):
        report.notes.append("pdftoppm isn't installed: hidden-colour text wasn't checked")
        render = False
    elif not render:
        report.notes.append("--no-render: white, covered or invisible-mode text wasn't checked")
    if pages > MAX_RENDER_PAGES and render:
        report.notes.append(f"only the first {MAX_RENDER_PAGES} of {pages} pages were rendered")

    xhtml = run(["pdftotext", "-bbox-layout", path, "-"])
    any_words = False
    for no, page in enumerate(PAGE_RE.finditer(xhtml), 1):
        width, height = float(page.group(1)), float(page.group(2))
        image, scale = None, 2.0
        if render and no <= MAX_RENDER_PAGES:
            dpi = min(144, int(3000 * 72 / max(width, height, 1)))
            scale = dpi / 72
            base = os.path.join(tmp, "page")
            soft(report, ["pdftoppm", "-singlefile", "-f", str(no), "-l", str(no), "-r", str(dpi), path, base],
                 f"page {no}'s hidden-colour text")
            if os.path.exists(base + ".ppm"):
                try:
                    image = read_ppm(base + ".ppm")
                except ToolError as e:
                    report.notes.append(f"page {no}'s hidden-colour text wasn't checked ({e})")
                finally:
                    os.remove(base + ".ppm")
        lines.append(mark(f"page {no}"))
        hidden_reason, hidden_words = None, []

        def flush():
            nonlocal hidden_reason, hidden_words
            if hidden_words:
                text = " ".join(hidden_words)
                report.add("hidden", f"{label} page {no}", f"{hidden_reason}: {clip(text)}")
            hidden_reason, hidden_words = None, []

        for block in BLOCK_RE.finditer(page.group(3)):
            for line in LINE_RE.finditer(block.group(1)):
                pieces, run_reason, run_words = [], None, []
                for w in WORD_RE.finditer(line.group(1)):
                    any_words = True
                    box = tuple(float(w.group(k)) for k in range(1, 5))
                    text = report.src(html.unescape(w.group(5)))
                    reason = word_reason(box, width, height, image, scale)
                    if reason != run_reason and run_words:
                        pieces.append(mark(f"hidden, {run_reason}", " ".join(run_words)))
                        run_words = []
                    if reason != hidden_reason:
                        flush()
                    if reason:
                        run_reason = reason
                        run_words.append(text)
                        hidden_reason = reason
                        hidden_words.append(text)
                    else:
                        run_reason = None
                        pieces.append(text)
                if run_words:
                    pieces.append(mark(f"hidden, {run_reason}", " ".join(run_words)))
                lines.append(" ".join(pieces))
            lines.append("")
            flush()
        rec = mupdf.get(no, {})
        for text in extra_runs(rec.get("big", ""), rec.get("normal", "")):
            text = report.src(text)
            report.add("hidden", f"{label} page {no}", f"outside the page: {clip(text)}")
            lines.append(mark("hidden, outside the page", text))
        for annot in rec.get("annots", []):
            contents = report.src(annot.get("contents", ""))
            if contents.strip():
                shown = annot.get("type") == "FreeText"
                if not shown:
                    report.add("hidden", f"{label} page {no}", f"{annot.get('type')} annotation: {clip(contents)}")
                lines.append(mark(f"{annot.get('type')} annotation, {'shown' if shown else 'not shown'} on the page", contents))
    if not any_words:
        report.notes.append(f"{label} has no text layer: it's pictures. Read the pages yourself; a reader may OCR them")
    return lines, f"PDF, {pages} page{'s' if pages != 1 else ''}"


# ---------------------------------------------------------------------- HTML

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
BLOCK = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "pre", "hr", "section",
         "article", "header", "footer", "ul", "ol", "dl", "dt", "dd", "td", "th"}
NONDISPLAY = {"script", "style", "template", "head", "title", "xml"}
WHITE_NAMES = {"white", "snow", "ivory", "ghostwhite", "whitesmoke", "floralwhite", "seashell", "mintcream", "azure",
               "aliceblue", "honeydew", "linen", "oldlace", "lavenderblush"}


def luminance(value):
    v = value.strip().lower()
    if v in WHITE_NAMES:
        return 250
    if v == "transparent":
        return -1
    m = re.fullmatch(r"#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?", v)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    m = re.fullmatch(r"rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?\)", v)
    if m:
        if m.group(4) is not None and float(m.group(4)) < 0.1:
            return -1
        r, g, b = (int(m.group(i)) for i in (1, 2, 3))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    return None


def style_decisions(style):
    """What a style does to visibility. 'hard' can't be undone by a child; the others go to the innermost setting."""
    s = re.sub(r"\s*([:;,(){}])\s*", r"\1", re.sub(r"\s+", " ", (style or "").lower())).replace("!important", "").strip()
    d = {}
    if re.search(r"(^|;|\{)display:none", s):
        d["hard"] = "display:none"
    elif "mso-hide:all" in s:
        d["hard"] = "mso-hide:all"
    elif re.search(r"(^|;)(max-)?(height|width|line-height):0(px|pt|em|%)?(;|$)", s) and "overflow:hidden" in s:
        d["hard"] = "zero size, overflow hidden"
    elif re.search(r"(^|;)(left|top|text-indent|margin-left|margin-top):-\d{3,}", s):
        d["hard"] = "pushed off-screen"
    elif re.search(r"clip:rect\(0(px)?,?0(px)?,?0(px)?,?0(px)?\)|clip-path:inset\((50|100)%\)", s):
        d["hard"] = "clipped away"
    m = re.search(r"(^|;)opacity:([\d.]+)(%?)", s)
    if m and "hard" not in d:
        v = float(m.group(2) or 0) / (100 if m.group(3) else 1)
        if v < 0.1:
            d["hard"] = f"opacity:{m.group(2)}{m.group(3)}"
    m = re.search(r"(^|;)visibility:(\w+)", s)
    if m:
        d["vis"] = "visibility:hidden" if m.group(2) in ("hidden", "collapse") else "ok"
    m = re.search(r"(^|;)font-size:([\d.]+)(px|pt|em|rem|%)?", s)
    if m:
        v, unit = float(m.group(2) or 0), m.group(3) or ""
        small = {"px": 3, "pt": 2, "em": 0.2, "rem": 0.2, "%": 20, "": 3}[unit]
        d["font"] = f"font-size:{m.group(2)}{unit}" if v < small else "ok"
    m = re.search(r"(^|;)color:([^;]+)", s)
    if m:
        fg = luminance(m.group(2))
        bg_m = re.search(r"(^|;)background(-color)?:([^;]+)", s)
        bg = luminance(bg_m.group(3).split()[0]) if bg_m else None
        if fg == -1:
            d["color"] = "transparent text"
        elif fg is not None and bg is not None and bg >= 0 and abs(fg - bg) < 20:
            d["color"] = "text the same colour as its background"
        elif fg is not None and fg >= 235 and (bg is None or bg >= 200):
            d["color"] = "white text on a light or unknown background"
        elif fg is not None:
            d["color"] = "ok"
    return d


class HtmlText(html.parser.HTMLParser):
    def __init__(self, report, label, hidden_rules):
        super().__init__(convert_charrefs=True)
        self.report, self.label, self.rules = report, label, hidden_rules
        self.stack, self.pieces, self.nondisplay, self.links, self.open_link = [], [], [], [], None

    def reason(self):
        for el in self.stack:
            if el.get("hard"):
                return el["hard"]
        for prop in ("vis", "font", "color"):
            for el in reversed(self.stack):
                if prop in el:
                    if el[prop] != "ok":
                        return el[prop]
                    break
        return None

    def handle_starttag(self, tag, attrs):
        a = {k: v or "" for k, v in attrs}
        if tag in BLOCK:
            self.pieces.append(("nl",))
        for attr, name in (("alt", "image alt text"), ("title", "hover text"), ("aria-label", "screen-reader label")):
            if len(a.get(attr, "").split()) >= 3:
                reason = self.reason()
                text = self.report.src(a[attr])
                self.pieces.append(("hidden", f"{name} inside {reason}", text) if reason else ("note", name, text))
        if tag == "a" and a.get("href"):
            self.links.append([a["href"], ""])
            self.open_link = len(self.links) - 1
        if tag in VOID:
            return
        d = {}
        for cls in a.get("class", "").split():
            for k, v in self.rules.get(cls, {}).items():
                d.setdefault(k, f"CSS class {cls} sets {v}" if v != "ok" else v)
        d.update(style_decisions(a.get("style")))
        if tag == "font" and a.get("color"):
            d.update({k: v for k, v in style_decisions(f"color:{a['color']}").items() if k == "color"})
        if "hidden" in a:
            d["hard"] = "hidden attribute"
        if tag in NONDISPLAY:
            d["hard"] = f"<{tag}>"
        d["tag"] = tag
        self.stack.append(d)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                break
        if tag == "a" and self.open_link is not None:
            href, text = self.links[self.open_link]
            self.open_link = None
            m = re.search(r"\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b", text.lower())
            host = url_flags(href)[0]
            if m and host and not (host == m.group(1) or host.endswith("." + m.group(1)) or m.group(1).endswith("." + host)):
                self.report.add("links", self.label, f"link text says {clip(m.group(1), 60)} but goes to {clip(host, 60)}")
        if tag in BLOCK:
            self.pieces.append(("nl",))

    def handle_data(self, data):
        if any(el["tag"] in NONDISPLAY for el in self.stack):
            self.nondisplay.append(data)
            return
        data = self.report.src(data.replace("\r", " ").replace("\n", " "))
        if self.open_link is not None:
            self.links[self.open_link][1] += data
        reason = self.reason() if data.strip() else None
        self.pieces.append(("hidden", reason, data) if reason else ("text", data))

    def handle_comment(self, data):
        text = re.sub(r"<[^>]*>|\[if [^\]]*\]>?|<!\[endif\]|\[endif\]", " ", data)
        if len(text.split()) >= 3:
            self.pieces.append(("hidden", "HTML comment", self.report.src(text)))

    def lines(self):
        out, merged = [], []
        for p in self.pieces:
            if merged and p[0] == "hidden" and merged[-1][0] == "hidden" and merged[-1][1] == p[1]:
                merged[-1] = ("hidden", p[1], merged[-1][2] + p[2])
            else:
                merged.append(p)
        for p in merged:
            if p[0] == "nl":
                out.append("\n")
            elif p[0] == "text":
                out.append(re.sub(r"[ \t]+", " ", p[1]))
            elif p[0] == "note":
                out.append(" " + mark(p[1], p[2]) + " ")
            elif p[2].strip():
                self.report.add("hidden", self.label, f"{p[1]}: {clip(p[2])}")
                out.append(" " + mark(f"hidden, {p[1]}", p[2]) + " ")
        text = re.sub(r"\n[ \t]+", "\n", "".join(out))
        return re.sub(r"\n{3,}", "\n\n", text).strip("\n").split("\n")


def hidden_css_rules(markup):
    rules = {}
    for block in re.findall(r"<style\b[^>]*>(.*?)</style>", markup, re.S | re.I):
        for selectors, body in re.findall(r"([^{}]+)\{([^{}]*)\}", block):
            d = {k: v for k, v in style_decisions(body).items() if v != "ok"}
            for cls in re.findall(r"\.([\w-]+)", selectors) if d else ():
                rules.setdefault(cls, {}).update(d)
    return rules


def check_html(markup, report, label):
    parser = HtmlText(report, label, hidden_css_rules(markup))
    parser.feed(markup)
    parser.close()
    for href, _ in parser.links:
        add_url(report, href, f"{label} link")
    for chunk in "".join(parser.nondisplay).split("\n"):
        if chunk.strip():
            scan_line(report, f"{label} <style>/<script>", unicodedata.normalize("NFKC", chunk))
    return parser.lines()


# --------------------------------------------------------------------- email

def part_text(part):
    try:
        return part.get_content()
    except (LookupError, UnicodeError, KeyError):
        return (part.get_payload(decode=True) or b"").decode("utf-8", "replace")


def domain_of(address):
    m = re.search(r"@([\w.-]+)", address or "")
    return m.group(1).lower() if m else ""


def check_eml(data, report, label, render, tmp, depth=0):
    msg = email.message_from_bytes(data, policy=email.policy.default)
    lines = []
    for key in ("From", "Reply-To", "To", "Cc", "Subject", "Date"):
        value = msg.get(key)
        if value:
            lines.append(f"{key}: {report.src(str(value))}")
    sender, reply = domain_of(str(msg.get("From", ""))), domain_of(str(msg.get("Reply-To", "")))
    if reply and sender and reply != sender:
        report.add("active", label, f"Reply-To goes to {reply}, not the sender's {sender}")
    lines.append("")
    plains, htmls, attachments = [], [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype, name = part.get_content_type(), part.get_filename()
        if part.get_content_disposition() == "attachment" or name:
            attachments.append(part)
        elif ctype == "text/plain":
            plains.append(part_text(part))
        elif ctype == "text/html":
            htmls.append(part_text(part))
    body_html = []
    for markup in htmls:
        body_html += check_html(markup, report, f"{label} HTML part")
    if htmls:
        lines += body_html
        for plain in plains:
            for text in extra_runs(plain, MARKER.sub(" ", " ".join(body_html)), least=4):
                text = report.src(text)
                report.add("hidden", f"{label} plain-text part", f"only in the plain-text part, mail clients show the HTML: {clip(text)}")
                lines.append(mark("hidden, only in the plain-text part", text))
    else:
        for plain in plains:
            lines += report.src(plain).replace("\r\n", "\n").split("\n")
    for part in attachments:
        name = report.src(part.get_filename() or "(no name)")
        payload = part.get_payload(decode=True) or b""
        ctype = part.get_content_type()
        report.add("active", label, f"attachment {clip(name, 80)} ({ctype}, {len(payload)} bytes)")
        lines += ["", mark("attachment", f"{name} ({ctype}, {len(payload)} bytes)")]
        sub = f"{label} attachment {name}"
        if depth >= 2:
            continue
        if payload[:5] == b"%PDF-":
            path = os.path.join(tmp, f"attachment-{len(os.listdir(tmp))}.pdf")
            with open(path, "wb") as f:
                f.write(payload)
            sub_lines, _ = check_pdf(path, report, sub, render, tmp)
            lines += sub_lines
        elif ctype == "message/rfc822" or ctype.startswith("text/"):
            kind = sniff(name, payload)
            if kind == "eml":
                lines += check_eml(payload, report, sub, render, tmp, depth + 1)[0]
            elif kind == "html":
                lines += check_html(payload.decode("utf-8", "replace"), report, sub)
            else:
                lines += report.src(payload.decode("utf-8", "replace")).split("\n")
        else:
            report.notes.append(f"attachment {name} ({ctype}) wasn't opened: check it separately")
    return lines, f"email, {len(attachments)} attachment{'s' if len(attachments) != 1 else ''}"


# ---------------------------------------------------------------------- main

def sniff(name, data):
    head = data[:4096]
    if head.startswith(b"%PDF-"):
        return "pdf"
    text = head.decode("utf-8", "replace")
    if re.match(r"(?:[\w-]+:.*\r?\n(?:[ \t].*\r?\n)*)*?(From|Received|Return-Path|MIME-Version|Delivered-To|Message-ID):",
                text, re.I) and re.search(r"^(From|Subject|Date):", text, re.I | re.M) or name.lower().endswith(".eml"):
        return "eml"
    if name.lower().endswith((".html", ".htm")) or re.search(r"<(html|body|div|span|p|table)\b", text, re.I):
        return "html"
    return "text"


def print_report(report, name, desc, copy_path, strip):
    safe = lambda s: mark_chars(s)[0]
    print(f"check_report: {safe(name)} ({desc})")
    print(f"checked copy: {copy_path}")
    print("  " + ("hidden parts dropped" if strip else "hidden parts marked ⟦like this⟧") + ". Paste this copy, not the original.")
    strong = weak = 0
    for kind, title in SECTIONS:
        items = report.items.get(kind, [])
        if not items:
            continue
        print(f"\n== {title} [{len(items)}]")
        for where, detail, is_weak in items[:LIST_LIMIT]:
            print(f"  {safe(where)}: {safe(detail)}" + ("  (weak)" if is_weak else ""))
        if len(items) > LIST_LIMIT:
            print(f"  … {len(items) - LIST_LIMIT} more")
        weak += sum(1 for i in items if i[2])
        strong += sum(1 for i in items if not i[2])
    if report.domains:
        print("\n== Link domains (for reference)")
        for host, count in report.domains.most_common(15):
            print(f"  {safe(host)} ×{count}")
    if report.addresses:
        print("\n== Cardano addresses in the text (for reference)")
        for addr, where in list(report.addresses.items())[:10]:
            print(f"  {addr[:14]}…{addr[-6:]}  ({where})")
    if report.notes:
        print("\n== Not checked")
        for note in report.notes:
            print(f"  {safe(note)}")
    print()
    if strong:
        print(f"Result: {strong} finding{'s' if strong != 1 else ''}" + (f" and {weak} weak signal{'s' if weak != 1 else ''}" if weak else "")
              + ". Read each one before pasting.")
    elif weak:
        print(f"Result: only weak signals ({weak}), listed above. Probably fine.")
    else:
        print("Result: nothing found. That isn't proof the text is safe: it's still a stranger's words.")
    return strong


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="a .pdf, .eml, .html or text file; - reads pasted text from stdin")
    ap.add_argument("--out", help="where the checked copy goes (default: beside the input, or a temp file for stdin)")
    ap.add_argument("--strip", action="store_true", help="drop hidden parts from the checked copy instead of marking them")
    ap.add_argument("--no-render", action="store_true", help="don't render PDF pages (skips the white/covered text check)")
    args = ap.parse_args()
    sys.stdout.reconfigure(errors="replace")

    if args.input == "-":
        data, name = sys.stdin.buffer.read(MAX_BYTES + 1), "pasted text"
    else:
        if os.path.getsize(args.input) > MAX_BYTES:
            print(f"{args.input} is over {MAX_BYTES // 2**20} MB: not checked", file=sys.stderr)
            return 2
        with open(args.input, "rb") as f:
            data, name = f.read(), os.path.basename(args.input)
    if len(data) > MAX_BYTES:
        print(f"input is over {MAX_BYTES // 2**20} MB: not checked", file=sys.stderr)
        return 2
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    kind = sniff(name, data)
    if kind == "text" and (data.count(b"\0") or data.decode("utf-8", "replace").count("�") > len(data) // 20 + 2):
        print(f"{name} isn't a PDF, an email, HTML or UTF-8 text: not checked (save a .docx as PDF first)", file=sys.stderr)
        return 2

    report = Report()
    with tempfile.TemporaryDirectory(prefix="check-report-") as tmp:
        try:
            if kind == "pdf":
                path = args.input
                if args.input == "-":
                    path = os.path.join(tmp, "input.pdf")
                    with open(path, "wb") as f:
                        f.write(data)
                lines, desc = check_pdf(path, report, "PDF", not args.no_render, tmp)
            elif kind == "eml":
                lines, desc = check_eml(data, report, "email", not args.no_render, tmp)
            elif kind == "html":
                lines, desc = check_html(data.decode("utf-8", "replace"), report, "HTML"), "HTML"
            else:
                lines, desc = report.src(data.decode("utf-8", "replace")).replace("\r\n", "\n").split("\n"), "text"
        except ToolError as e:
            print(f"check_report: {e}", file=sys.stderr)
            return 2
    checked = finish(report, lines, args.strip)

    if args.out:
        out = args.out
    elif args.input == "-":
        out = os.path.join(tempfile.gettempdir(), time.strftime("report-%Y%m%d-%H%M%S.checked.txt"))
    else:
        out = args.input + ".checked.txt"
    with open(out, "w", encoding="utf-8") as f:
        f.write(checked)
    return 1 if print_report(report, name, desc, out, args.strip) else 0


if __name__ == "__main__":
    sys.exit(main())
