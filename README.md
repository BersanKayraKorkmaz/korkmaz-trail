# korkmaz-trail

**An audit trail for your AI agent, above the Claude Code prompt.**

Claude Code runs commands, edits files and reaches out to the web on your behalf. korkmaz-trail keeps a running record of what the agent actually did this session (commands, files changed, outbound calls, risky actions) and shows it next to the numbers you check anyway: your 5-hour and weekly plan limits, context and cost.

It stays quiet while everything is nominal and speaks up when something deserves a human look. It's a Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview), so it draws in the Desktop app's Code tab and in the terminal alike.

![korkmaz-trail in three states: all clear, worth a look, act now](assets/preview.png)

## Reading the bar

| | |
|---|---|
| `■` | Overall state: green nominal, amber worth a look, red act now |
| `❯ 118` | Shell commands Claude ran this session (Bash and PowerShell) |
| `✎ 21` | Distinct files it created or edited |
| `⇅ 9` | Outbound actions: web fetches and searches, remote URLs, network commands (`git push`, `npm install`, `curl`…) |
| `⚠ 2 · git reset --hard` | Risky actions so far, and the latest one |
| `5h ▰▰▰▰▰▱ 76% ↻2h40m` | 5-hour plan limit used, and time until it resets |
| `→ limit in 47m` | Appears only when, at your recent pace, you would hit the limit before it resets |
| `7d` | Weekly plan limit |
| `ctx 81%` | Context window used |
| `$12.80` | Claude Code's own session cost estimate, at API list prices |

The bar uses your theme's colors and drops the gauges, then the detail, when the window is narrow.

## What counts as risky

These are heuristics, not a sandbox: korkmaz-trail flags actions worth a second look. It never blocks or approves anything; every tool call passes through unchanged.

**High:** recursive deletes aimed at `/`, `~`, `$HOME`, `*` or `..`; `git push --force`; piping a download into a shell (`curl … | sh`, `irm … | iex`); disk formatting; `DROP TABLE`; `terraform destroy`, `kubectl delete`; a credential pasted into a command; reading SSH private keys, `.key`/`.p12` files or cloud CLI credentials.

**Medium:** `git reset --hard`, `git clean -f`, `--no-verify`; `sudo`; `chmod 777`; publishing (`npm publish`, `docker push`…); firewall, Defender or execution-policy changes; shutdowns; reading or editing `.env`, `secrets.*` or `.pem` files.

To keep false alarms down, heredoc bodies count as file contents rather than commands, and `.env.example`, globs (`ls .env*`) and flags (`--exclude=.env`) are ignored. A high-severity action turns the square red for 15 minutes, then amber for the rest of the session.

## Install

You need Claude Code with mods (v2.1.287 or later). Plan limits appear for Claude Pro and Max subscribers.

In a Claude Code session, add this repository as a plugin marketplace and install the plugin:

```text
/plugin marketplace add BersanKayraKorkmaz/korkmaz-trail
/plugin install korkmaz-trail@korkmaz-trail
```

The same from your shell, with the bar in Turkish:

```bash
claude plugin marketplace add BersanKayraKorkmaz/korkmaz-trail
claude plugin install korkmaz-trail@korkmaz-trail --config language=tr
```

Start a new session, or run `/reload-plugins`, and the bar appears above the prompt. To change the language later, run `/plugin configure korkmaz-trail`. To remove it, run `/plugin uninstall korkmaz-trail@korkmaz-trail`.

To try it from a clone without installing, start Claude Code with `claude --plugin-dir ./korkmaz-trail`.

## Privacy and safety

korkmaz-trail runs inside Claude Code, so it's worth knowing exactly what it touches. `claude plugin validate` lists every event a mod handles and every call it makes; for korkmaz-trail that's:

```text
hooks: session.start, classic.SessionStart{source=clear|resume|fork}, tool.call, session.measure, ui.render{component=AbovePrompt}
calls: $.clock.every, $.clock.now, $.session.messages, $.session.usage, $.ui.invalidate, $.ui.resolve
```

- No file access, network requests, processes or model calls, and no dependencies.
- Nothing is written to disk. The counters live in memory for the session.
- Detected credentials are never displayed. Everything it shows from a tool call is stripped of control characters, escape sequences and bidirectional overrides, so a crafted command can't repaint your screen.

## How the forecast works

Claude Code reports your plan usage after every turn and whenever a limit moves. korkmaz-trail keeps those readings in memory: the 5-hour forecast uses the burn rate over the last 30 minutes, the weekly one the last 6 hours, and with too little history it falls back to the window's average rate. Nothing is shown unless the projection crosses 100% before the reset.

## Known gaps

- When the mod joins a session late, after `/resume` or a fresh install, it rebuilds the trail from the conversation's recent messages.
- Commands that run inside MCP servers or other tools aren't seen.
- Pattern matching misses some risky actions and occasionally flags harmless ones. Use permission rules, hooks and sandboxing for enforcement; korkmaz-trail is for awareness.
- Mods are new, and their events can change between releases. Tested with Claude Code 2.1.286 on Windows, where mods were already rolling out.

## Türkçe

korkmaz-trail, Claude Code ajanının bu oturumda gerçekte ne yaptığının denetim izini giriş kutusunun hemen üstünde tutar: çalıştırdığı komutlar, değiştirdiği dosyalar, internete çıkışları ve riskli işlemleri. Bunları zaten takip ettiğin sayıların yanına koyar: 5 saatlik ve haftalık plan limitleri, bağlam ve maliyet. Masaüstü uygulamasında da terminalde de çalışır.

```bash
claude plugin marketplace add BersanKayraKorkmaz/korkmaz-trail
claude plugin install korkmaz-trail@korkmaz-trail --config language=tr
```

![korkmaz-trail Türkçe görünüm](assets/preview-tr.png)

Hiçbir veri bilgisayarından çıkmaz, diske hiçbir şey yazmaz, bağımlılığı yoktur. Hiçbir işlemi engellemez, yalnızca görünür kılar.

## Development

```bash
npm test                 # rules and layout, with node:test
claude plugin test       # the mod itself, drawn for the terminal and the Desktop app
claude plugin validate .claude-plugin/plugin.json
npm run preview          # assets/preview.html and preview-tr.html, for screenshots
```

## License

MIT © 2026 Berşan Kayra Korkmaz

Not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.
