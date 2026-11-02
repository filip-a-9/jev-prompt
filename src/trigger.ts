// When to grade (spec 4.1, 4.2). No I/O: the caller passes the clock in.

import type { Config } from "./types";

export type Timer = { cancel: () => void };
export type Schedule = (ms: number, fn: () => void) => Timer;

/**
 * Restarts an idle wait on every edit that changes the text. The caller
 * starts the wait itself (`start`), since only a hook may reach the clock.
 */
export function createDebounce() {
	let timer: Timer | undefined;
	let lastText: string | undefined;
	return {
		edited(text: string, start: () => Timer): void {
			if (text === lastText) return;
			lastText = text;
			timer?.cancel();
			timer = start();
		},
		cancel(): void {
			timer?.cancel();
			timer = undefined;
			lastText = undefined;
		},
	};
}

export type Decision = {
	kind: "hide" | "wait" | "cached" | "grade";
	/** What goes to Jev: the box text, or the prompt inside a command. */
	draft: string;
};

type Options = Pick<
	Config,
	"minChars" | "requireEndPunctuation" | "promptCommands"
>;

/** The prompt inside a prompt-taking slash command; undefined if none. */
function commandPrompt(
	trimmed: string,
	promptCommands: readonly string[],
): string | undefined {
	const m = /^\/(\S+)\s+([\s\S]*)$/.exec(trimmed);
	if (!m?.[1] || !promptCommands.includes(m[1].toLowerCase())) return undefined;
	const rest = m[2] ?? "";
	if (m[1].toLowerCase() !== "loop") return rest;
	// A loop may run another command: that is not a prompt.
	const prompt = rest.replace(/^\d+[smhd](\s+|$)/, "");
	return prompt.startsWith("/") ? undefined : prompt;
}

/**
 * What to do with the box text when the idle wait ends. The length and
 * punctuation rules apply to the draft; the cache compares the full text.
 */
export function decide(
	text: string,
	options: Options,
	lastGradedText: string | undefined,
): Decision {
	const trimmed = text.trim();
	const hide: Decision = { kind: "hide", draft: "" };
	let draft = text;
	if (trimmed.startsWith("/")) {
		const prompt = commandPrompt(trimmed, options.promptCommands);
		if (prompt === undefined) return hide;
		draft = prompt;
	} else if (trimmed.startsWith("!")) return hide;
	const body = draft.trim();
	if (body.length < options.minChars) return hide;
	if (options.requireEndPunctuation && !/[.?!]$/.test(body)) {
		return { kind: "wait", draft };
	}
	if (text === lastGradedText) return { kind: "cached", draft };
	return { kind: "grade", draft };
}

/**
 * At most one run at a time. `$.http.fetch` cannot be aborted, so a request
 * made while one runs waits; only the newest waiting one runs next.
 */
export function createSingleFlight() {
	type Run = (text: string) => Promise<void>;
	let busy = false;
	let waiting: { text: string; run: Run } | undefined;
	const request = async (text: string, run: Run): Promise<void> => {
		if (busy) {
			waiting = { text, run };
			return;
		}
		busy = true;
		try {
			await run(text);
		} finally {
			busy = false;
			const next = waiting;
			waiting = undefined;
			if (next) void request(next.text, next.run).catch(() => {});
		}
	};
	return {
		request,
		drop(): void {
			waiting = undefined;
		},
		/** Whether a request is queued behind the running one. */
		waiting: (): boolean => waiting !== undefined,
	};
}
