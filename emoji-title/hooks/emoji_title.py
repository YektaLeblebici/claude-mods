"""UserPromptSubmit hook: prefix the session title with one fitting emoji.

Runs once per session. Every later prompt exits at the first check without
reading the transcript or calling a model. Never blocks a prompt: any failure
exits 0 with no output.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# Set on the nested `claude -p` so its own UserPromptSubmit hook exits at once
# instead of starting another nested session, and another, without end.
NESTED = "EMOJI_TITLE_NESTED"
# The calling session's own handles. Left in, the nested `claude -p` counts as
# that session's child and can report a title back to it, renaming it.
SESSION_LINK = {
    "CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_AGENT", "CLAUDE_CODE_ENTRYPOINT",
}
STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "claude-emoji-title"
STATE_MAX_AGE = 90 * 86400
MAX_TITLE = 80
AI_TITLE = b'"type":"ai-title"'

EMOJI = "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\u2300-\u23FF]"
LEADING_EMOJI = re.compile(EMOJI)
ONE_EMOJI = re.compile(f"{EMOJI}(?:\uFE0F|[\U0001F3FB-\U0001F3FF]|\u200D{EMOJI}\uFE0F?)*")
# Control characters (ESC, newlines) and bidi/zero-width marks that could
# garble or spoof the prompt bar.
UNSAFE = re.compile("[\x00-\x1f\x7f-\x9f\u200B-\u200F\u202A-\u202E\u2066-\u2069]")

# First match wins, so more specific words come first.
KEYWORDS = [
    ("🐛", r"bug|debug|crash|broken|error|exception|traceback|fix(es|ing)?"),
    ("🔒", r"secur\w*|auth\w*|permission\w*|secret\w*|vuln\w*|credential\w*|token\w*"),
    ("🧪", r"tests?|testing|spec|flaky|pytest|jest|coverage"),
    ("🚀", r"deploy\w*|release\w*|ship\w*|launch\w*|rollout"),
    ("⚡", r"perf\w*|optimi[sz]\w*|speed|slow|latency|fast(er)?"),
    ("🗄️", r"database|db|sql|postgres\w*|mysql|migration\w*|schema|query|queries"),
    ("🐳", r"docker\w*|container\w*|kubernetes|k8s|helm"),
    ("☁️", r"aws|gcp|azure|cloud|terraform|infra\w*"),
    ("🔧", r"config\w*|settings?|setup|install\w*|env"),
    ("🌿", r"git|branch\w*|merge|rebase|commit\w*|pr|pull request"),
    ("♻️", r"refactor\w*|clean ?up|simplif\w*|rename\w*"),
    ("🎨", r"ui|css|design|style\w*|layout|theme|frontend"),
    ("📊", r"chart\w*|dashboard\w*|metric\w*|analytics|graph\w*|plot\w*"),
    ("📝", r"docs?|documentation|readme|write ?up|notes?|blog"),
    ("🔌", r"api|endpoint\w*|webhook\w*|plugin\w*|mod|mods|hooks?|integration\w*"),
    ("🤖", r"claude|llm|ai|model|prompt\w*|agent\w*|mcp"),
    ("🐍", r"python|django|flask|pip"),
    ("🦀", r"rust|cargo"),
    ("🐹", r"golang"),
    ("💻", r"shell|bash|zsh|terminal|cli|script\w*"),
    ("📦", r"dependenc\w*|package\w*|npm|yarn|upgrade\w*"),
    ("🔍", r"search\w*|investigat\w*|research\w*|explor\w*"),
    ("📚", r"learn\w*|explain\w*|understand\w*|tutorial|how to"),
    ("👋", r"greeting\w*|hello"),
]
KEYWORD_RES = [(e, re.compile(rf"\b(?:{words})\b")) for e, words in KEYWORDS]


def clean(title):
    return re.sub(r"\s+", " ", UNSAFE.sub(" ", title)).strip()[:MAX_TITLE]


def latest_ai_title(path):
    """Claude's auto-title, stored in the transcript as {"type":"ai-title",...}.

    An undocumented format: anything unexpected reads as "no title yet".
    """
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    at = data.rfind(AI_TITLE)
    if at < 0:
        return None
    start = data.rfind(b"\n", 0, at) + 1
    end = data.find(b"\n", at)
    try:
        title = json.loads(data[start : end if end >= 0 else None]).get("aiTitle")
    except ValueError:
        return None
    return title if isinstance(title, str) and title.strip() else None


def keyword_emoji(title):
    lowered = title.lower()
    return next((e for e, pattern in KEYWORD_RES if pattern.search(lowered)), None)


def haiku_emoji(title):
    """One lean, unsaved Haiku session: short system prompt, no tools, no MCP."""
    try:
        reply = subprocess.run(
            [
                "claude", "-p", "--model", "haiku",
                "--no-session-persistence", "--tools", "", "--disable-slash-commands", "--strict-mcp-config",
                "--system-prompt",
                "You pick the single emoji that best fits a conversation title. Reply with exactly one emoji and nothing else.",
                f"Title: {title}",
            ],
            env={**{k: v for k, v in os.environ.items() if k not in SESSION_LINK}, NESTED: "1"},
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    match = ONE_EMOJI.search(reply.stdout) if reply.returncode == 0 else None
    return match.group(0) if match else None


def mark_done(session_id):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / session_id).touch()
    cutoff = time.time() - STATE_MAX_AGE
    for old in STATE_DIR.iterdir():
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)


def main():
    if os.environ.get(NESTED):
        return
    event = json.load(sys.stdin)
    session_id = re.sub(r"[^A-Za-z0-9_-]", "", str(event.get("session_id", "")))
    custom = event.get("session_title") or ""

    # Fast path: no transcript read, no model call.
    if LEADING_EMOJI.match(custom) or not session_id or (STATE_DIR / session_id).exists():
        return

    # A /rename title gets the emoji; otherwise Claude's auto-title, which only
    # exists after the first reply, so the first prompt passes through.
    title = clean(custom or latest_ai_title(event.get("transcript_path") or "") or "")
    if not title:
        return

    mark_done(session_id)  # one attempt per session, success or not
    emoji = keyword_emoji(title) or haiku_emoji(title)
    if emoji:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "sessionTitle": f"{emoji} {title}"}}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # never block or garble a prompt over a title
