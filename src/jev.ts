// The only place a Jev call happens, and the only place the spend cap is
// enforced (spec 4.6, 4.11).
//
// It takes an `Io` of closures instead of the engine's `$`: a hooks module may
// not pass `$` as an argument, so hooks/register.tsx builds the Io from
// `$.http.fetch`, `$.clock`, `$.store` and `$.ui.log` at its call site.

import { levelCount, QUESTIONS } from "./rubric";
import {
	type Answers,
	type ChoiceAnswer,
	type Config,
	DIMENSIONS,
	type Dimension,
	type JevOutcome,
	type JevState,
	type ScoreAnswer,
	type Spend,
} from "./types";

export const SPEND_KEY = "jev.spend";
const URL = "https://openrouter.ai/api/alpha/decisions";

export type Io = {
	fetch(
		url: string,
		init: { method: string; headers: Record<string, string>; body: string },
	): Promise<{
		status: number;
		ok: boolean;
		headers: Record<string, string>;
		text: string;
	}>;
	now(): Promise<number>;
	after(ms: number, fn: () => void): { cancel(): void };
	storeGet(key: string): Promise<unknown>;
	storeSet(key: string, value: unknown): Promise<void>;
	log(text: string): void;
};

const pad = (n: number) => String(n).padStart(2, "0");

const nonNegative = (v: unknown): number =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Today's totals: a stored day or month that is not the current one reads as 0. */
export async function loadSpend(io: Io): Promise<Spend> {
	const d = new Date(await io.now());
	const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
	const day = `${month}-${pad(d.getDate())}`;
	let raw: unknown;
	try {
		raw = await io.storeGet(SPEND_KEY);
	} catch {
		raw = undefined;
	}
	const s = isObject(raw) ? raw : {};
	return {
		day,
		dayUsd: s.day === day ? nonNegative(s.dayUsd) : 0,
		month,
		monthUsd: s.month === month ? nonNegative(s.monthUsd) : 0,
	};
}

async function record(io: Io, costUsd: number): Promise<void> {
	try {
		const s = await loadSpend(io);
		await io.storeSet(SPEND_KEY, {
			...s,
			dayUsd: s.dayUsd + costUsd,
			monthUsd: s.monthUsd + costUsd,
		});
	} catch {
		// A store that fails must not turn a finished call into an error.
	}
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function costOf(parsed: unknown): number | undefined {
	if (!isObject(parsed) || !isObject(parsed.usage)) return undefined;
	const c = parsed.usage.cost;
	return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : undefined;
}

const num = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

function probabilities(v: unknown): Record<string, number> | undefined {
	if (!isObject(v)) return undefined;
	const out: Record<string, number> = {};
	for (const [k, p] of Object.entries(v)) {
		if (!num(p)) return undefined;
		out[k] = p;
	}
	return out;
}

/** Scores come to two decimals; this much past either end is rounding noise. */
const SCORE_SLACK = 0.01;

function scoreAnswer(v: unknown, d: Dimension): ScoreAnswer | undefined {
	if (!isObject(v) || v.type !== "score") return undefined;
	const probs = probabilities(v.probabilities);
	if (!num(v.score) || !num(v.confidence) || !probs) return undefined;
	const top = levelCount(d) - 1;
	if (v.score < -SCORE_SLACK || v.score > top + SCORE_SLACK) return undefined;
	return {
		type: "score",
		score: Math.min(top, Math.max(0, v.score)),
		confidence: v.confidence,
		probabilities: probs,
	};
}

function choiceAnswer(v: unknown): ChoiceAnswer | undefined {
	if (!isObject(v) || v.type !== "choice") return undefined;
	const probs = probabilities(v.probabilities);
	if (typeof v.choice !== "string" || !num(v.confidence) || !probs) {
		return undefined;
	}
	return {
		type: "choice",
		choice: v.choice,
		confidence: v.confidence,
		probabilities: probs,
	};
}

/** The response check: every question answered, each of the right shape. */
function checkAnswers(parsed: unknown): Answers | undefined {
	if (!isObject(parsed) || !isObject(parsed.answers)) return undefined;
	const a = parsed.answers;
	const task_type = choiceAnswer(a.task_type);
	if (!task_type) return undefined;
	const dims: Partial<Record<Dimension, ScoreAnswer>> = {};
	for (const d of DIMENSIONS) {
		const s = scoreAnswer(a[d], d);
		if (!s) return undefined;
		dims[d] = s;
	}
	return { task_type, ...(dims as Record<Dimension, ScoreAnswer>) };
}

/** OpenRouter's refusal when no provider meets the data policy (not captured). */
function isZdrRefusal(status: number, parsed: unknown): boolean {
	if (status !== 404 || !isObject(parsed) || !isObject(parsed.error)) {
		return false;
	}
	const m = parsed.error.message;
	return typeof m === "string" && /data policy|zdr/i.test(m);
}

type Settled =
	| { offline: true }
	| { offline: false; status: number; ok: boolean; text: string };

export async function jevCall(
	io: Io,
	config: Config,
	state: JevState,
): Promise<JevOutcome> {
	if (config.apiKey === undefined) return { kind: "key-rejected" };

	const body = JSON.stringify({
		model: config.model,
		state,
		questions: QUESTIONS,
		...(config.requireZdr ? { provider: { zdr: true } } : {}),
	});
	const estimate = (bytes(body) / 3) * (config.priceUsdPerMTok / 1e6);

	const spend = await loadSpend(io);
	if (
		spend.dayUsd + estimate > config.dailyBudgetUsd ||
		spend.monthUsd + estimate > config.monthlyBudgetUsd
	) {
		return { kind: "budget" };
	}

	// $.http.fetch cannot be aborted, so the fetch runs on and records its own
	// cost whenever it lands; the timeout only decides what we return now.
	const fetched: Promise<Settled> = (async () => {
		let res: Awaited<ReturnType<Io["fetch"]>>;
		try {
			res = await io.fetch(URL, {
				method: "POST",
				headers: {
					authorization: `Bearer ${config.apiKey}`,
					"content-type": "application/json",
				},
				body,
			});
		} catch {
			await record(io, estimate);
			return { offline: true };
		}
		await record(io, costOf(parseJson(res.text)) ?? estimate);
		return { offline: false, status: res.status, ok: res.ok, text: res.text };
	})();

	let timer: { cancel(): void } | undefined;
	const timedOut = new Promise<"timeout">((resolve) => {
		timer = io.after(config.timeoutMs, () => resolve("timeout"));
	});
	const settled = await Promise.race([fetched, timedOut]);
	timer?.cancel();

	if (settled === "timeout" || settled.offline) return { kind: "offline" };
	if (settled.status === 401 || settled.status === 403) {
		return { kind: "key-rejected" };
	}
	if (settled.status === 429) return { kind: "rate-limited" };
	const parsed = parseJson(settled.text);
	if (isZdrRefusal(settled.status, parsed)) return { kind: "zdr-unavailable" };
	if (settled.ok) {
		const answers = checkAnswers(parsed);
		if (answers) {
			return {
				kind: "ok",
				answers,
				costUsd: costOf(parsed) ?? estimate,
			};
		}
	}
	io.log(settled.text);
	return { kind: "unexpected", body: settled.text };
}
