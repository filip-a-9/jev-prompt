import type { JevState } from "./types";

/**
 * Secret patterns (spec 4.4), applied in order: specific before general, so a
 * PEM block or an `sk-ant-` key is labelled as such. Every regex is global.
 */
export const PATTERNS: readonly { kind: string; re: RegExp }[] = [
	{
		kind: "private-key",
		re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	},
	{ kind: "jwt", re: /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g },
	{ kind: "anthropic-key", re: /(?<![\w-])sk-ant-[\w-]{20,}/g },
	{ kind: "openrouter-key", re: /(?<![\w-])sk-or-[\w-]{20,}/g },
	{ kind: "openai-key", re: /(?<![\w-])sk-[\w-]{20,}/g },
	{ kind: "github-token", re: /ghp_[A-Za-z0-9]{36,}/g },
	{ kind: "github-token", re: /github_pat_[\w]{22,}/g },
	{ kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
	{ kind: "slack-token", re: /xox[abpr]-[A-Za-z0-9-]{10,}/g },
	{ kind: "url-credentials", re: /\w+:\/\/[^\s:@]+:[^\s@]+@/g },
	{
		kind: "assignment",
		re: /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
	},
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
