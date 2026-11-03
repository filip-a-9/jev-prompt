# jev-prompt

A Claude Code mod that grades the prompt you are typing, live, with
[Jev](https://typesafe.ai) through OpenRouter.

## What it does

This is a reference mod: a working example of grading prompts live through a
mod. The grader works. Whether its hints make prompts better has not been
shown (see [What the evidence says](#what-the-evidence-says)).

While you type, jev-prompt waits for a pause and then shows one line above the prompt box.

```
jev  bug fix  ·  missing: expected result, the failing command
jev  bug fix  ·  clear
```

The line names the kind of prompt and what it seems to lack. It is advisory only: it never blocks a submit and never rewrites your text. It stays quiet when it is uncertain, and for prompts it has no opinion on.

## Requirements

- Claude Code 2.1.287 or newer with mods turned on. Tested on 2.1.316 and 2.1.317. The mod API is early access and may change.
- An [OpenRouter](https://openrouter.ai) API key.
- Node 26 or newer only if you want to develop it.

## Install

```
/plugin marketplace add filip-a-9/jev-prompt
/plugin install jev-prompt@jev-prompt
/plugin configure jev-prompt@jev-prompt
```

Secret options such as the key do not show in `/config`; use `/plugin configure`. With no GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` before adding the marketplace. Update with `claude plugin update jev-prompt@jev-prompt`; auto-update is off for third-party marketplaces.

## What leaves your machine

Each grade is one `POST https://openrouter.ai/api/alpha/decisions`, which OpenRouter routes to TypeSafe's Jev. Nothing else is sent anywhere. A request goes out only after 7 seconds without typing, on a draft of at least 10 characters. Slash commands and `!` shell mode are skipped, except the commands listed in `promptCommands` (`/goal` and `/loop` by default), where the text after the command is graded. A request contains:

- the draft (at most 10 KB)
- your previous prompt (at most 1 KB)
- the tail of Claude's last reply (at most 3 KB)
- project instructions (at most 6 KB): `CLAUDE.md`, `CLAUDE.local.md` and `.claude/CLAUDE.md` from the working directory
- the rubric questions

The whole request is capped at 16 KB. `requireZdr` is on by default and restricts routing to zero-data-retention endpoints. `/jev off` pauses grading. OpenRouter publishes no retention or training policy for this model, so none is claimed here; read TypeSafe's [privacy policy](https://typesafe.ai/legal/privacy-policy) and [terms](https://typesafe.ai/legal/terms). `claude plugin validate .` lists every hook and call the plugin makes.

## Redaction

Before sending, text is scrubbed locally by pattern: known API key prefixes, PEM private keys, JWTs, `key=value` secrets and connection strings. This is pattern-based, so a secret with no recognisable key name or prefix is sent as written. Keep secrets out of prompts and instruction files, or run `/jev off`.

## Cost

About $0.00025 per grade at the default price. Hard caps of $0.10 a day and $1.65 a month are shared by all sessions and enforced on the `usage.cost` OpenRouter reports. The defaults are sized for roughly $10 per half-year. Raise them in `/plugin configure`.

## Commands and settings

`/jev` shows the status: grading on or off, the rough numeric grade, and a warning when the model differs from the calibrated one. `/jev off` and `/jev on` pause and resume grading.

| Key                     | Default                      | Meaning                                                               |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------- |
| `openrouterApiKey`      | —                            | Your OpenRouter key, kept in secure storage.                          |
| `model`                 | `typesafe/jev-1.14-20261014` | Jev model, pinned exactly because weights are calibrated per version. |
| `idleMs`                | `7000`                       | Milliseconds of typing pause before a grade.                          |
| `requireEndPunctuation` | `false`                      | Grade only drafts ending in `.`, `?` or `!`.                          |
| `minChars`              | `10`                         | Shorter drafts are not graded.                                        |
| `monthlyBudgetUsd`      | `1.65`                       | Hard cap per calendar month.                                          |
| `dailyBudgetUsd`        | `0.1`                        | Hard cap per local day.                                               |
| `priceUsdPerMTok`       | `0.042`                      | USD per million input tokens, used for the pre-call estimate only.    |
| `timeoutMs`             | `3000`                       | A slower answer shows the band as offline.                            |
| `requireZdr`            | `true`                       | Route only to zero-data-retention endpoints.                          |
| `promptCommands`        | `goal,loop`                  | Slash commands whose argument is graded; empty turns this off.        |

## What the evidence says

All the evidence comes from one user's real prompts. The labels were made
by three blind Claude labellers (majority or median vote), not by a person.
The harness and the data are private, so these numbers cannot be reproduced
from this repository.

- **Calibration.** Over 84 labelled prompts, the band agreed with the label
  71% of the time (leave-one-out). The target was 80%.
- **Fresh tasks.** This check was not possible. Only 9 task-opening prompts
  were found, and 40 were needed. The band agreed on 2 of those 9.
- **Do hints point at trouble?** Trouble means the next prompt interrupts,
  corrects or rephrases. Over 217 prompts with a known outcome, 10% were
  followed by trouble.
  - When the band showed a hint (25 prompts), 24% were followed by trouble.
    The 95% interval is 11% to 43%.
  - A low grade ranks trouble above chance, but only just: AUC 0.60.
  - The check passed by the smallest margin it allows. One prompt more or
    less would change the result.
- **Trouble detection.** The detector of trouble agreed with hand labels on
  36 of 40 fresh prompts. Almost all of those prompts were smooth, though,
  and it caught 1 of 5 real troubles.
- **Not shown.** Whether people write better prompts with the hint, or would
  keep it on. No study of real use was run.

## Limits

- The endpoint is alpha. If its response shape changes, the band shows `unexpected response`.
- The dated model pin may be retired by the provider.
- Changing `model` gives uncalibrated grades, which `/jev` flags.

## Development

```
npm ci
npm test
npm run lint
npm run typecheck
```

`npm test` needs the `claude` CLI. `npm run typecheck` needs the engine types in `.claude-plugin/types/`, which are gitignored. No CLI command writes them: Claude Code writes them itself when it loads the mod from a folder you own, so start an interactive session with the mod installed from a local folder. On a fresh clone without them `tsc` fails, so CI skips it. CI runs `npm ci`, `biome check`, `node --test checks/`, `claude plugin validate . --strict` and `claude plugin test .`, none of which needs credentials.

The rubric's sha256 test fails on any rewording: rewording the rubric means recalibrating it.

## License

MIT, see `LICENSE`.
