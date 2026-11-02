// When to grade (spec 4.1, 4.2). No I/O: the caller passes the clock in.

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

export type Decision = "hide" | "wait" | "cached" | "grade";

/** What to do with the box text when the idle wait ends. */
export function decide(
	text: string,
	options: { minChars: number; requireEndPunctuation: boolean },
	lastGradedText: string | undefined,
): Decision {
	const trimmed = text.trim();
	if (trimmed.length < options.minChars) return "hide";
	if (trimmed.startsWith("/") || trimmed.startsWith("!")) return "hide";
	if (options.requireEndPunctuation && !/[.?!]$/.test(trimmed)) return "wait";
	if (text === lastGradedText) return "cached";
	return "grade";
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
