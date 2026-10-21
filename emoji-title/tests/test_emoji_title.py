"""Run: python3 -I tests/test_emoji_title.py (from the plugin folder)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "emoji_title.py"

TRANSCRIPT = "\n".join([
    '{"type":"user","message":"hi"}',
    '{"type":"ai-title","aiTitle":"old title","sessionId":"s"}',
    '{"type":"ai-title","aiTitle":"%s","sessionId":"s"}',
    '{"type":"assistant","message":"ok"}',
])


class EmojiTitleTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.calls = self.tmp / "claude-calls.log"
        stub = self.tmp / "bin" / "claude"
        stub.parent.mkdir()
        # Stands in for `claude -p`: records the call and the loop guard.
        stub.write_text(f'#!/bin/sh\necho "guard=$EMOJI_TITLE_NESTED sid=$CLAUDE_CODE_SESSION_ID" >> {self.calls}\nprintf "%s" "${{STUB_REPLY:-🦜}}"\n')
        stub.chmod(0o755)
        self.env = {**os.environ, "CLAUDE_CODE_SESSION_ID": "parent-session", "PATH": f"{stub.parent}:{os.environ['PATH']}", "XDG_STATE_HOME": str(self.tmp / "state")}
        self.env.pop("EMOJI_TITLE_NESTED", None)

    def run_hook(self, ai_title=None, session_title=None, session_id="s1", env=None, transcript=None):
        path = self.tmp / "t.jsonl"
        path.write_text(transcript if transcript is not None else (TRANSCRIPT % ai_title if ai_title else '{"type":"user"}'))
        event = {"session_id": session_id, "transcript_path": str(path), "prompt": "next"}
        if session_title:
            event["session_title"] = session_title
        out = subprocess.run([sys.executable, "-I", str(HOOK)], input=json.dumps(event), capture_output=True, text=True, env={**self.env, **(env or {})})
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)["hookSpecificOutput"]["sessionTitle"] if out.stdout.strip() else None

    def haiku_calls(self):
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def test_keyword_match_needs_no_model(self):
        self.assertEqual(self.run_hook("fix flaky login test"), "🐛 fix flaky login test")
        self.assertEqual(self.haiku_calls(), [])

    def test_haiku_fallback_runs_with_loop_guard(self):
        self.assertEqual(self.run_hook("weekend sourdough plans"), "🦜 weekend sourdough plans")
        self.assertEqual(self.haiku_calls(), ["guard=1 sid="])  # loop guard on, parent session id gone

    def test_later_prompts_short_circuit(self):
        self.run_hook("weekend sourdough plans")
        self.assertIsNone(self.run_hook("weekend sourdough plans"))
        self.assertEqual(len(self.haiku_calls()), 1)

    def test_title_with_emoji_is_left_alone(self):
        self.assertIsNone(self.run_hook("anything", session_title="🚀 deploy"))
        self.assertFalse((self.tmp / "state").exists())

    def test_rename_title_gets_emoji(self):
        self.assertEqual(self.run_hook(None, session_title="tax-return docs"), "📝 tax-return docs")

    def test_waits_until_auto_title_exists(self):
        self.assertIsNone(self.run_hook(None))
        self.assertEqual(self.run_hook("python packaging"), "🐍 python packaging")

    def test_nested_session_exits_immediately(self):
        self.assertIsNone(self.run_hook("weekend sourdough plans", env={"EMOJI_TITLE_NESTED": "1"}))
        self.assertEqual(self.haiku_calls(), [])

    def test_haiku_junk_reply_keeps_one_emoji(self):
        self.assertEqual(self.run_hook("weekend sourdough plans", env={"STUB_REPLY": "Sure! 🍞 here \x1b[31m"}), "🍞 weekend sourdough plans")

    def test_haiku_failure_gives_no_title_and_no_retry(self):
        self.assertIsNone(self.run_hook("weekend sourdough plans", env={"STUB_REPLY": "no emoji"}))
        self.assertIsNone(self.run_hook("weekend sourdough plans"))
        self.assertEqual(len(self.haiku_calls()), 1)

    def test_control_characters_are_stripped(self):
        t = '{"type":"ai-title","aiTitle":"evil\\u001b[2Jtitle\\ndocs"}'
        self.assertEqual(self.run_hook(transcript=t), "📝 evil [2Jtitle docs")

    def test_bad_input_never_blocks(self):
        out = subprocess.run([sys.executable, "-I", str(HOOK)], input="not json", capture_output=True, text=True, env=self.env)
        self.assertEqual((out.returncode, out.stdout), (0, ""))


class MarkerPruneTest(unittest.TestCase):
    def test_a_marker_another_session_prunes_first_does_not_stop_this_one(self):
        import importlib.util, pathlib
        spec = importlib.util.spec_from_file_location("emoji_title", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        hook.STATE_DIR = Path(tempfile.mkdtemp())
        (hook.STATE_DIR / "gone").touch()
        real_stat = pathlib.Path.stat

        def vanishing_stat(path, *args, **kwargs):
            # Another session unlinks "gone" between listing the folder and reading its age.
            if path.name == "gone":
                raise FileNotFoundError(path)
            return real_stat(path, *args, **kwargs)

        pathlib.Path.stat = vanishing_stat
        try:
            hook.mark_done("s1")
        finally:
            pathlib.Path.stat = real_stat
        self.assertTrue((hook.STATE_DIR / "s1").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
