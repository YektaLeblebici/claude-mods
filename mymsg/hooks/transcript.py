"""Lists, in conversation order, the ids of a session's stored rows mymsg can list.

Run: python3 -I transcript.py <session id> <offset>

Prints the offset the transcript was read up to, then one id per line: prompts,
messages sent mid-turn and slash commands' rows. Subagents' rows, tool results
and rows meant only for the model are left out. Reading starts at <offset> and
stops at the last whole line, so a row still being written is read next time.
A transcript not written yet prints <offset> and nothing else.
"""
import glob
import json
import os
import sys


def listed(row):
    if row.get("isSidechain") or row.get("isMeta"):
        return False
    kind = row.get("type")
    if kind == "user":
        content = row.get("message", {}).get("content")
        return not (isinstance(content, list) and content and isinstance(content[0], dict) and content[0].get("type") == "tool_result")
    if kind == "system":
        return row.get("subtype") == "local_command"
    if kind == "attachment":
        return (row.get("attachment") or {}).get("type") == "queued_command"
    return False


def main(session, offset):
    home = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    found = glob.glob(os.path.join(glob.escape(home), "projects", "*", glob.escape(session) + ".jsonl"))
    if not found:
        print(offset)
        return
    with open(found[0], "rb") as transcript:
        transcript.seek(offset)
        data = transcript.read()
    whole = data.rfind(b"\n") + 1
    print(offset + whole)
    for line in data[:whole].splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("uuid") and listed(row):
            print(row["uuid"])


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
