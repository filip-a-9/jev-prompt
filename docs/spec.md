# jev-prompt — live prompt grader for Claude Code

Status: design, not built. Target: Claude Code 2.1.316 mod API (hooks module).
Audience: the author first; written so it can be published as a plugin later.

## 1. What it does

While you type in the Claude Code prompt box, jev-prompt waits until the draft
is at least 10 characters and you have stopped typing for 10 seconds (section
4.1). It then
grades the draft 0–100% against a prompting rubric and shows the score above
the prompt box together with the 1–3 biggest gaps:

```
jev 58%  bug fix  ·  missing: how to verify, error output
```

It is advisory only. Enter always sends; the grade never blocks, delays or
rewrites a prompt.

## 2. Decisions taken in the interview

| Topic          | Decision                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grader         | Jev (TypeSafe's decision model) through OpenRouter, using the author's existing key. Jev gives probability-weighted scores and generates no text.                           |
| Trigger        | ≥ 10 chars and 10 s idle; a 5 s pause fired mid-thought. Punctuation never shortens the wait. An opt-in setting additionally requires the draft to end in `.` `?` `!`. |
| Cost           | About $10 per half-year at most: hard caps of $1.65 a month and $0.10 a day (section 4.6).                                                                             |
| Grade shape    | 0–100%, a weighted combination of per-dimension Jev scores (TypeSafe's "composite scoring" pattern).                                                                   |
| Methodology    | Anthropic prompting guidance, project-aware (CLAUDE.md), task-type aware.                                                                                              |
| Feedback       | Score plus the top gaps in a band above the prompt. No inline marks, no rewrite, no history in v1.                                                                     |
| On submit      | Never interferes.                                                                                                                                                      |
| Short replies  | Context-aware: "yes, do that" after Claude asked a question is a good prompt.                                                                                          |
| Context sent   | Draft, Claude's last reply, your previous prompt, and the project's CLAUDE.md, capped below Jev's 32 KB fast-mode limit.                                               |
| Secrets        | Redacted locally before sending; `/jev off` pauses grading.                                                                                                            |
| Existing tools | None found that grades live while typing. PromptOps, PQS and claude-code-auditor all grade on demand or grade files.                                                   |

## 3. Platform facts this design relies on

All verified against the 2.1.316 mod types (`claude-code.d.ts`) and the Jev docs.

| Need                  | Mechanism                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Every keystroke       | `on('prompt.edit')`: one event per edit the person makes                                                 |
| Other draft changes   | `on('prompt.change')`: history recall, paste, completion, dictation                                      |
| Idle timer            | `$.clock.after(ms, fn)` returns a cancellable timer                                                      |
| Read the draft        | `$.prompt.read()` returns `{ text, cursor }`                                                             |
| Clear on send         | `on('prompt.submit')`, passed straight through with `next(e)`                                            |
| Band above the prompt | `on('ui.render', { component: 'AbovePrompt' })`, with values in `atom`s so a write redraws it            |
| Conversation context  | `$.session.messages()` returns `{ role, text, toolUses }[]`                                              |
| CLAUDE.md             | `$.fs.read(path)`, relative to the session cwd, 4 MiB max                                                |
| HTTP                  | `$.http.fetch(url, init)` (mods have no Node and no global fetch)                                        |
| API key               | manifest `userConfig` field marked sensitive, kept in secure storage, arrives in `register(on, options)` |
| Spend across sessions | `$.store` (persists across sessions)                                                                     |
| Command               | `$.command.register` in `session.start`, answered by `command.run`                                       |

Jev via OpenRouter:

- `POST https://openrouter.ai/api/alpha/decisions`, `Authorization: Bearer <key>`
- Body `{ model, state, questions }`; question types `score`, `choice`, `noul`.
- A score answer is `{ score, probabilities, confidence, legend }`. `score` is
  the probability-weighted level index, from 0 to `levels − 1`.
- A choice answer is `{ choice, probabilities, confidence }`.
- All questions in a request are judged in parallel and independently, so
  they cost one call.
- Billing: input tokens only, about $0.042 per million (Jev 1.13 listing).
  The response carries `usage.cost` in USD.
- Inputs over about 32 KB switch to a slower, less accurate long-context mode.
- The endpoint is **alpha**: field names may change.

## 4. Architecture

```
 keystroke ──► prompt.edit ─┐
 paste/history ► prompt.change ─┴─► Trigger (10 s idle; O(1) on the key path)
                                         │ fires
                                         ▼
                              $.prompt.read() ── skip? (see 4.2)
                                         │
                   ┌─────────────────────┼──────────────────────┐
                   ▼                     ▼                      ▼
         $.session.messages()     CLAUDE.md cache          draft text
         last assistant reply     (re-read ≤ 1/min)
         previous user prompt
                   └──────────► State builder ◄─────────────────┘
                                 (truncate to budget)
                                         │
                                         ▼
                                    Redactor
                                         │
                                         ▼
                        Budget gate ──► Jev client ──► OpenRouter
                        (hard cap)      (timeout, 1 flight)
                                         │ answers
                                         ▼
                                  Grader (weights, gaps)
                                         │
                                         ▼
                              band atom ──► AbovePrompt band
```

### 4.1 Trigger

- `prompt.edit` and `prompt.change` hooks run on the typing path. They only
  cancel the pending timer, start a new `$.clock.after(idleMs)`, mark the band
  stale, and return `next(e)`. No I/O. `prompt.edit` awaits `next(e)` only
  to learn the text the edit produced.
- `idleMs` is 10000, so a pause to think mid-sentence does not trigger a
  grade. Punctuation never shortens it.
- Opt-in `requireEndPunctuation` (default off): when the timer fires, also
  require the draft, ignoring trailing whitespace, to end in `.` `?` or `!`.
  Otherwise skip, and the next edit restarts the wait. The draft's end decides,
  not the cursor. A `.` mid-draft (`file.ts`, `e.g.`) has no effect.
- An edit that leaves the text unchanged (a pure cursor move) does not restart
  the timer.
- When the timer fires, it starts a grade for the current box text. `$.http.fetch`
  cannot be aborted, so at most one request runs at a time: a grade asked for
  while one runs waits, and only the newest waiting one runs next. The timeout
  races the response against `$.clock.after(timeoutMs)`; a response that lands
  late is still counted against the budget.
- When the result arrives, it is applied only if `$.prompt.read().text` still
  equals the text that was graded. Otherwise it is dropped.
- `prompt.submit` cancels the timer, drops any waiting grade, clears the band, and
  passes the event on unchanged.

### 4.2 Skip rules (no API call)

- `text.trim().length < minChars` (10): hide the band.
- The draft starts with `/` (slash command) or `!` (bash mode).
- The text equals the last graded text: re-show the cached grade.
- Grading is paused (`/jev off`) or no API key is set (band shows
  `jev: set key in /config`, once per session).
- The budget is exhausted (see 4.6): band shows `jev: budget reached`.

### 4.3 State sent to Jev

A JSON object, so that questions can name its fields:

```json
{
	"draft": "<the prompt being written>",
	"previous_user_prompt": "<last user message with text, tool results excluded>",
	"last_assistant_reply": "<tail of Claude's last text reply>",
	"project_instructions": "<CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md, concatenated>"
}
```

Size budget: 16 KB total, about 4–5k tokens. This is set by cost (section
4.6), and is well under the 32 KB fast-mode limit. Each context field also has
its own cap: `project_instructions` 6 KB (head), `last_assistant_reply` 3 KB
(tail, since the closing question matters most), `previous_user_prompt` 1 KB.
If the total still exceeds 16 KB, the fields are cut further in that order.
The draft is never cut below 10 KB; a longer draft is graded on its first
10 KB.

The CLAUDE.md files are read on `session.start` and re-read at most once a
minute. A missing file gives an empty string.

### 4.4 Redaction

Runs over the whole state, CLAUDE.md included, just before the call. Each
match is replaced with `[REDACTED:<kind>]`:

- provider keys: `sk-…`, `sk-or-…`, `sk-ant-…`, `ghp_…`, `github_pat_…`,
  `AKIA[0-9A-Z]{16}`, `xox[abpr]-…`; `sk-` only at the start of a word, so
  `risk-assessment-…` is left alone
- PEM blocks: `-----BEGIN … PRIVATE KEY-----` up to the matching END line,
  or to the end of the field when truncation cut the END line off
- JWTs: `eyJ…\.eyJ…\.…`
- assignments: `(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+`
- connection strings with credentials: `\w+://[^\s:@]+:[^\s@]+@`

Patterns live in one table with a test per kind. No entropy-based guessing in
v1, because it produces too many false positives on hashes and ids.

### 4.5 Rubric (one Jev call)

Built on Anthropic's prompting guidance: be clear and direct, give context and
the reason for the task, state what done looks like, constrain the scope, point
at the concrete things (files, errors), and ask for one coherent piece of work.
Claude Code's own practices add pointing at files and giving Claude a way to
verify its work.

Every Score question is worded "judging `draft`, taking into account what
`last_assistant_reply`, `previous_user_prompt` and `project_instructions`
already establish". That clause is what makes it project-aware and
context-aware: something already said in CLAUDE.md or in the last exchange
counts as present.

Questions, all in one request:

| Key            | Type   | Measures                                                   | Levels (low → high, each described as a situation, per Jev guidance)                                                                             |
| -------------- | ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task_type`    | choice | what kind of request                                       | `bug_fix`, `feature`, `refactor`, `question`, `review`, `ops` (shell, git, deploy), `follow_up` (answers or steers Claude's last reply), `other` |
| `goal`         | score  | the desired outcome is unambiguous                         | 4 levels: no recognisable goal → goal guessable → goal stated but open to two readings → one clear outcome                                       |
| `context`      | score  | Claude has what it needs to start (where, what, which)     | 4 levels: would have to ask or search blindly → … → names files, symbols or the error, or the context already gives them                         |
| `verification` | score  | how done or correct will be judged                         | 3 levels: none → implied → explicit (a test, expected output, an acceptance check)                                                               |
| `constraints`  | score  | scope and boundaries stated where they matter              | 3 levels: unbounded where it matters → partly → limits and non-goals clear                                                                       |
| `evidence`     | score  | for problems: what was observed versus expected            | 3 levels: none → vague ("it's broken") → concrete (error text, repro, observed vs expected)                                                      |
| `focus`        | score  | one coherent request                                       | 3 levels: several unrelated asks → related but sprawling → one focused request                                                                   |
| `rationale`    | score  | why, where it changes the answer                           | 3 levels: none where it matters → hinted → the reason is given                                                                                   |
| `output`       | score  | the shape of the answer or deliverable                     | 3 levels: unspecified where it matters → partly → clear (length, format, file, plan vs code)                                                     |
| `reply_fit`    | score  | a follow-up unambiguously answers or steers the last reply | 3 levels: unclear what it refers to → mostly clear → unambiguous                                                                                 |

Level wording follows Jev's Score guidance: describe situations, not degrees;
one dimension per question; a structured `{ what, examples }` per level where
calibration shows neighbouring levels getting split.

### 4.6 Spend cap

- Every Jev call goes through one function, `jevCall`, in `src/jev.ts`. That
  call site is the only place the cap is enforced.
- Target: at most about $10 per half-year.
- Before calling: estimate the cost as `bytes(state + questions) / 3` tokens
  times the configured price. Refuse if that would exceed
  `monthlyBudgetUsd = 1.65` (calendar month) or `dailyBudgetUsd = 0.10`.
  The daily cap stops one heavy day from using up the month.
- After calling: add `usage.cost` from the response, or the estimate if the
  response lacks it, to both totals in `$.store`, keyed by local date and
  month. One shared budget covers every session.
- Expected spend: state 16 KB plus questions about 3 KB is roughly 6k input
  tokens, about $0.00025 per grade at $0.042/M. The daily cap allows about
  400 grades. A realistic 50–150 grades a day costs $0.40–1.15 a month,
  $2.50–7 per half-year.
- If grading turns out to need more context than 16 KB allows, raising the
  state budget is the lever, and the caps keep the cost bounded regardless.
- At most one request in flight. A 429 response pauses grading for 30 s.
- A grade that waited behind another call checks again before it is sent: no
  call once a 401/403 or 429 has stopped or paused grading, or when the draft
  has changed since it was queued.

### 4.7 Grader (pure functions)

1. Normalise each score: `s_d = score_d / (levels_d − 1)`.
2. Weights depend on task type. `W[type][d]` is a table in `src/rubric.ts`
   whose rows each sum to 1, with a weight of 0 where a dimension does not
   apply (e.g. `evidence` outside `bug_fix`, `reply_fit` outside `follow_up`).
3. No threshold on task type. Weights are blended by Jev's type
   probabilities, `w_d = Σ_t p(t) · W[t][d]`, so an uncertain type gives a
   smooth mix instead of a hard switch.
4. `grade = round(100 · Σ_d w_d · s_d)`.
5. Gaps are the dimensions with `w_d ≥ 0.10` and `s_d < 0.5`, ranked by
   `w_d · (1 − s_d)`, top 3, each shown by its short label (`how to verify`,
   `which file/error`, …).
6. Certainty: if the weighted mean of the score confidences is below 0.4,
   the grade is shown as `~58%`.

Starting weights (to be calibrated, section 6):

| type      | goal | context | verification | constraints | evidence | focus | rationale | output | reply_fit |
| --------- | ---- | ------- | ------------ | ----------- | -------- | ----- | --------- | ------ | --------- |
| bug_fix   | .20  | .20     | .15          | .05         | .25      | .10   | .05       | 0      | 0         |
| feature   | .25  | .20     | .15          | .15         | 0        | .10   | .10       | .05    | 0         |
| refactor  | .20  | .20     | .20          | .20         | 0        | .10   | .10       | 0      | 0         |
| question  | .35  | .25     | 0            | .05         | 0        | .15   | .05       | .15    | 0         |
| review    | .25  | .25     | .10          | .15         | 0        | .10   | .05       | .10    | 0         |
| ops       | .30  | .25     | .15          | .20         | 0        | .10   | 0         | 0      | 0         |
| follow_up | .15  | .10     | 0            | 0           | 0        | .10   | 0         | 0      | .65       |
| other     | .30  | .25     | .10          | .10         | 0        | .15   | .05       | .05    | 0         |

### 4.8 Band

- `ui.render` on `AbovePrompt`. If `e.props.hasSurvey` is set, the band shows
  nothing.
- One line: `jev <grade>%  <type label>  ·  missing: <gaps>`.
- Colour by grade: ≥ 80 green, 50–79 yellow, < 50 red.
- Stale (typing after a grade), `grading…`, and notices use explicit mid-gray
  (ansi256 245). Never `dimColor`, which renders black on the author's black
  background.
- Hidden when the draft is under 10 characters and after submit.

### 4.9 Command

`/jev`:

- `/jev`: status (on/off, today's spend against the cap, model) and the last
  grade's full breakdown: every dimension's score, weight and confidence, plus
  the task-type probabilities.
- `/jev on` and `/jev off`: session toggle, kept in `$.state`.

### 4.10 Configuration (`userConfig`, read once in `src/config.ts`)

| Field                   | Type              | Default             | Note                                                                                   |
| ----------------------- | ----------------- | ------------------- | -------------------------------------------------------------------------------------- |
| `openrouterApiKey`      | string, sensitive | none                | secure storage, never in settings.json                                                 |
| `model`                 | string            | `typesafe/jev-1.14` | pinned exact: scores shift between Jev releases, so weights are calibrated per version |
| `idleMs`                | number            | 10000               | pause mid-sentence                                                                     |
| `requireEndPunctuation` | boolean           | false               | when on, grade only drafts ending in `.` `?` `!` (still after `idleMs`)                |
| `minChars`              | number            | 10                  |                                                                                        |
| `monthlyBudgetUsd`      | number            | 1.65                | hard cap, about $10 per half-year (section 4.6)                                        |
| `dailyBudgetUsd`        | number            | 0.10                | hard cap, section 4.6                                                                  |
| `priceUsdPerMTok`       | number            | 0.042               | used for the pre-call estimate only                                                    |
| `timeoutMs`             | number            | 3000                |                                                                                        |
| `requireZdr`            | boolean           | true                | send `provider: { zdr: true }`: only zero-data-retention endpoints may serve the call  |

`src/config.ts` validates these into one typed object. No other module reads
`options`.

### 4.11 Failure handling

| Case                                                                      | Band                              | Then                                      |
| ------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------- |
| network error or timeout                                                  | `jev: offline` (gray)             | retry on the next idle                    |
| 401/403                                                                   | `jev: key rejected`               | stop until the config changes             |
| 429                                                                       | `jev: rate limited`               | pause 30 s                                |
| no endpoint meets the ZDR requirement (`requireZdr` on)                   | `jev: no zero-retention provider` | stop until the config changes             |
| 4xx/5xx with a different shape, or unexpected answer fields (alpha drift) | `jev: unexpected response`        | full body to the debug log via `$.ui.log` |
| a hook throws                                                             | engine skips the hook and logs it | typing is never affected                  |

## 5. Layout

```
jev-prompt/
  .claude-plugin/plugin.json   name, version, description, userConfig, types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           wiring only: events → trigger, band, command
  src/config.ts                options → typed Config
  src/trigger.ts               debounce and stale-result guard
  src/context.ts               messages + CLAUDE.md → state, truncation
  src/redact.ts                pattern table + redact()
  src/rubric.ts                questions, level texts, weight table, gap labels
  src/grade.ts                 answers → { grade, type, gaps, certain }
  src/jev.ts                   jevCall(): budget gate, fetch, response check
  src/band.tsx                 AbovePrompt render
  types/index.d.ts             PluginState: band value, paused flag
  tests/*.test.ts              claude plugin test
  docs/spec.md                 this file
```

`claude plugin validate` accepts relative imports from `hooks/register.tsx`
into `src/`. The engine lets `$` reach only top-level functions of the hooks
module and its own files, and never be stored, so `src/jev.ts` takes an `Io`
object that `register.tsx` builds from `$`.

Development runs project-local with `claude --plugin-dir
<repo folder>`. The skill's default dev folder under
`~/.claude/` is global, which goes against the project-local rule.

## 6. Testing and calibration

- TDD per the `test-driven-development` skill, run by `claude plugin test`.
- Pure units (`redact`, `context` truncation, `grade`, `config`): expected
  values written by hand. Example: normalised scores 0.5 and 1.0 with weights
  0.6 and 0.4 give exactly 70. Never derived from the code under test.
- The `jev.ts` response check uses one captured real Jev response per answer
  type as fixtures, not hand-built mocks of the client.
- Trigger: with the test kit's mocked clock, verify that edits within 10 s
  give no call, 10 s of idle gives one call, a draft ending in `?` still
  waits the full 10 s, and with `requireEndPunctuation` on, a draft ending
  mid-sentence gets no call while one ending in `.` gets one. Also that a
  stale result is dropped and submit clears the band.
- Calibration (manual, before trusting the numbers): about 20 of the author's real
  prompts, each labelled good / ok / poor by the author, graded once. Weights are
  adjusted until the bands agree. Jev's own docs warn that probabilities vary
  between requests and that thresholds need checking against real examples.

## 7. Risks and open points

- **Alpha API.** `/api/alpha/decisions` may change shape. Mitigation: the
  response check and the `unexpected response` state, with the model pinned.
- **Data policy.** OpenRouter's Jev guide does not state TypeSafe's retention
  or logging. Drafts and CLAUDE.md go to TypeSafe. Check the model page's
  data policy before first real use. Redaction reduces the exposure but does
  not remove it.
  `requireZdr` (default on) restricts the call to zero-data-retention
  endpoints; if none serves Jev, grading stops with a notice.
- **Price** is taken from the Jev 1.13 listing. Confirm the 1.14 price on
  OpenRouter. The cap is enforced on `usage.cost` either way.
- **Accuracy** of a classifier-style judge on short prompts is unproven.
  Calibration (section 6) is what makes the number meaningful.
- **Publishing later.** The key stays in secure storage and the repository
  carries `.gitignore` per the global rules. The marketplace install is
  `/plugin install jev-prompt --marketplace <owner>/<repo>`.

## 8. Out of scope for v1

Inline marks in the draft, one-key rewrite, score history and `/jev-stats`,
blocking or confirming on submit, and per-user rubric files.
