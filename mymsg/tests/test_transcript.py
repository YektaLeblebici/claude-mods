"""Run: python3 -I tests/test_transcript.py (from the plugin folder)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "hooks" / "transcript.py"

ROWS = [
    {"type": "user", "uuid": "prompt", "message": {"content": "fix the bug"}},
    {"type": "assistant", "uuid": "reply", "message": {"content": [{"type": "text", "text": "ok"}]}},
    {"type": "user", "uuid": "result", "message": {"content": [{"type": "tool_result", "tool_use_id": "t"}]}},
    {"type": "user", "uuid": "meta", "isMeta": True, "message": {"content": "for the model"}},
    {"type": "user", "uuid": "sub", "isSidechain": True, "message": {"content": "a subagent's prompt"}},
    {"type": "system", "subtype": "local_command", "uuid": "echo", "content": "<command-name>/cost</command-name>"},
    {"type": "system", "subtype": "local_command", "uuid": "output", "content": "<local-command-stdout>$0</local-command-stdout>"},
    {"type": "system", "subtype": "informational", "uuid": "notice", "content": "a hook was skipped"},
    {"type": "attachment", "uuid": "mid-turn", "attachment": {"type": "queued_command", "prompt": "also this"}},
    {"type": "attachment", "uuid": "file", "attachment": {"type": "file"}},
]


class TranscriptTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.path = self.home / "projects" / "-home-me" / "s1.jsonl"
        self.path.parent.mkdir(parents=True)

    def run_script(self, offset=0, session="s1"):
        env = {**os.environ, "CLAUDE_CONFIG_DIR": str(self.home)}
        out = subprocess.run([sys.executable, "-I", str(SCRIPT), session, str(offset)], env=env, capture_output=True, text=True, check=True)
        end, *ids = out.stdout.split()
        return int(end), ids

    def write(self, text):
        with open(self.path, "a") as transcript:
            transcript.write(text)

    def test_lists_prompts_commands_and_mid_turn_messages_in_order(self):
        self.write("".join(json.dumps(row) + "\n" for row in ROWS))
        self.assertEqual(self.run_script()[1], ["prompt", "echo", "output", "mid-turn"])

    def test_reads_on_from_the_offset_and_leaves_a_half_written_row(self):
        self.write(json.dumps(ROWS[0]) + "\n" + '{"type": "user", "uu')
        end, ids = self.run_script()
        self.assertEqual(ids, ["prompt"])
        self.write('id": "next", "message": {"content": "more"}}\n')
        self.assertEqual(self.run_script(end), (self.path.stat().st_size, ["next"]))

    def test_a_transcript_not_written_yet_lists_nothing(self):
        self.assertEqual(self.run_script(5, session="nobody"), (5, []))

    def test_a_broken_line_is_skipped(self):
        self.write("not json\n" + json.dumps(ROWS[0]) + "\n")
        self.assertEqual(self.run_script()[1], ["prompt"])


if __name__ == "__main__":
    unittest.main()
