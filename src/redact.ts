import type { JevState } from "./types";

// Case-insensitive letters one by one, so the regexes below can use real
// capitals for camelCase (`passwordHash`) without `secretary` matching.
const ci = (w: string) =>
	w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

// After a colon these words are prose ("the token: it expires"), not a value.
// Only a whole word counts (followed by white space or the end): "in-the-x"
// and "a/b" are values. After `=` and inside quotes everything is a value.
const FILLER =
	"a|an|the|it|is|are|was|were|will|would|can|could|should|must|may|might|has|have|had|that|this|these|those|to|of|in|on|for|and|or|but|not|no|we|you|i|they|he|she|if|when|which|what|how|why|as|at|by|with|from|be|been|expires|expired|needs"
		.split("|")
		.map(ci)
		.join("|");
const fillerWord = `(?:${FILLER})(?:\\s|$)`;

const NAMES = [
	"password",
	"passwd",
	"pwd",
	"secret",
	"token",
	`${ci("api")}[_-]?${ci("key")}`,
]
	.map((n) => (n.includes("[_-]") ? n : ci(n)))
	.join("|");

// A key name may be joined to other words: before it by `_` (DB_PASSWORD,
// aws_secret_access_key), after it by `_`, `-` or a capital (SECRET_KEY,
// secret-key, passwordHash). `secretary` and `tokenizer` do not match. The
// prefix may only begin at a word start and every run is bounded, so a long
// word cannot make the scan quadratic.
const word = "[A-Za-z0-9]{1,40}";
const key = (names: string) =>
	`["']?(?:(?<![A-Za-z0-9])(?:${word}_){1,5})?(?:${names})` +
	`(?:[_-][A-Za-z0-9_-]{0,80}|(?:[A-Z][a-z0-9]+){1,4})?["']?`;

// Separator and value: `=` or `:` on the key's line, the value on that line or
// on an indented line below (YAML), never on an unindented one.
const sep =
	`(?:[ \\t]*=[ \\t]*|[ \\t]*:[ \\t]*(?!${fillerWord}))` +
	`(?:\\r?\\n[ \\t]+)?`;
const quoted = `"(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`[^\`\\n]*\``;
const credential = `(?:${ci("Bearer")}|${ci("Basic")})[ \\t]+\\S+`;

// Authorization takes any `<scheme> <credential>`; the other keys a quoted
// string taken whole, a Bearer/Basic credential, or one word.
const AUTHORIZATION = new RegExp(
	`${key(ci("authorization"))}${sep}(?:${quoted}|[A-Za-z][\\w-]*[ \\t]+\\S+|\\S+)`,
	"g",
);
// A command-line flag takes its value after a space: `--password hunter2`.
const FLAG = new RegExp(
	`--(?:${word}[-_]){0,3}(?:${NAMES})[ \\t]+(?!-|${fillerWord})(?:${quoted}|\\S+)`,
	"g",
);
const ASSIGNMENT = new RegExp(
	`${key(NAMES)}${sep}(?:${quoted}|${credential}|\\S+)`,
	"g",
);

/**
 * Secret patterns (spec 4.4), applied in order: specific before general, so a
 * PEM block or an `sk-ant-` key is labelled as such. Every regex is global.
 */
export const PATTERNS: readonly { kind: string; re: RegExp }[] = [
	{
		kind: "private-key",
		re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	},
	{ kind: "jwt", re: /(?<!\w)eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g },
	{ kind: "anthropic-key", re: /(?<![\w-])sk-ant-[\w-]{20,}/g },
	{ kind: "openrouter-key", re: /(?<![\w-])sk-or-[\w-]{20,}/g },
	{ kind: "openai-key", re: /(?<![\w-])sk-[\w-]{20,}/g },
	{ kind: "github-token", re: /ghp_[A-Za-z0-9]{36,}/g },
	{ kind: "github-token", re: /github_pat_[\w]{22,}/g },
	{ kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
	{ kind: "slack-token", re: /xox[abpr]-[A-Za-z0-9-]{10,}/g },
	{
		kind: "url-credentials",
		re: /(?<!\w)\w+:\/\/[^\s:@]{1,512}:[^\s@]{1,512}@/g,
	},
	{ kind: "assignment", re: AUTHORIZATION },
	{ kind: "assignment", re: FLAG },
	{ kind: "assignment", re: ASSIGNMENT },
];

export function redact(text: string): string {
	let out = text;
	for (const { kind, re } of PATTERNS) {
		out = out.replace(re, `[REDACTED:${kind}]`);
	}
	return out;
}

export function redactState(s: JevState): JevState {
	return {
		draft: redact(s.draft),
		previous_user_prompt: redact(s.previous_user_prompt),
		last_assistant_reply: redact(s.last_assistant_reply),
		project_instructions: redact(s.project_instructions),
	};
}
