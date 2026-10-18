# claude-mods

Personal Claude Code plugins.

## q

A task queue for Claude Code: `/q <task>` queues prompts that run one after another,
only once the previous task has fully finished, and `/q` opens a pane to reorder,
edit, approve and fork them into parallel worktrees. See [q/README.md](q/README.md).

## emoji-title

Prefixes each Claude Code session title with one fitting emoji, once per session:
`fix flaky login test` becomes `🐛 fix flaky login test`.

### Install

At a Claude Code prompt:

```
/plugin install emoji-title --marketplace YektaLeblebici/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user = every project).
Remove it with `claude plugin uninstall emoji-title`, or switch it off in `/plugin`.

Requires `python3` on `PATH`. The Haiku fallback also needs the `claude` CLI on `PATH`;
without it, titles that match no keyword just stay as they are.

### How it works

A `UserPromptSubmit` command hook (`emoji-title/hooks/emoji_title.py`):

1. **Every message:** if the title already starts with an emoji, or this session was
   handled before, it exits at once: no transcript read, no model call (~100 ms, mostly
   Python start-up).
2. **Once per session, from the second message:** it reads Claude's auto-title from the
   session transcript (Claude writes it after its first reply, so the first message never
   gets one), picks an emoji, and sets the title. A title you set with `/rename` gets
   the emoji in front instead.
3. **Picking the emoji:** a keyword table (24 emojis, 132 patterns, first match wins).
   Only when nothing matches does it ask Claude Haiku once, through a nested
   `claude -p --model haiku` with a one-line system prompt, no tools and no saved session
   (~1,075 tokens, about $0.0002).

One attempt per session: if Haiku fails, the session keeps its plain title. Marker files
live in `$XDG_STATE_HOME/claude-emoji-title` (default `~/.local/state/…`) and are pruned
after 90 days.

### Cost

Measured on real sessions: about half of conversations reach a second message, and the
keyword table covers roughly 60% of those, so 100 conversations cost about 20,000 Haiku
tokens (~$0.004). Worst case, a Haiku call in every conversation: 107,500 tokens (~$0.02).

### Privacy and safety

- Reads only the auto-title line of the local transcript; the only thing sent anywhere is
  that title, to Haiku, and only when no keyword matches.
- Keeps one emoji from the model's reply, strips control and bidi characters from the
  title, and caps it at 80 characters, so pasted text cannot put escape codes in your
  prompt bar.
- The nested `claude -p` carries a guard variable so its own hook exits at once (no
  runaway chain of sessions), and the calling session's handles are removed from its
  environment so it cannot rename the session that started it.
- Never blocks a prompt: any error exits 0 with no output.

### Limitations

- Relies on the undocumented `ai-title` record in Claude Code transcripts. If a release
  changes it, the plugin quietly stops adding emojis.
- The title is fixed at Claude's early auto-title; later refinements stay hidden once a
  custom title is set.
- `claude -p` sessions never get an auto-title, so scripts are never titled (or charged).
- Untested on Windows.

### Why a command hook and not a hooks-module mod

Some organizations' managed Claude Code setups skip user hooks-module mods on
`classic.*` events, while plugin command hooks still run. A command hook works in both.

### Tests

```
cd emoji-title && python3 -I tests/test_emoji_title.py
```
