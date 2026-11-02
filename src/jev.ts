// The only place a Jev call happens, and the only place the spend cap is
// enforced (spec 4.6, 4.11).
//
// It takes an `Io` of closures instead of the engine's `$`: a hooks module may
// not pass `$` as an argument, so hooks/register.tsx builds the Io from
// `$.http.fetch`, `$.clock`, `$.store` and `$.ui.log` at its call site.

import { levelCount, RUBRIC } from "./rubric";
import {
	type Answers,
	type ChoiceAnswer,
	type Config,
	DIMENSIONS,
	type Dimension,
	type JevOutcome,
	type JevState,
	type Questions,
	type Rubric,
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

/** The local day and month a time belongs to. */
function keysOf(ms: number): { day: string; month: string } {
	const d = new Date(ms);
	const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
	return { day: `${month}-${pad(d.getDate())}`, month };
}

/** A reservation this old is from a fetch that never landed: forget it. */
const PENDING_TTL_MS = 10 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");

const nonNegative = (v: unknown): number =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function livePending(raw: unknown, now: number): Spend["pending"] {
	const out: Record<string, { usd: number; at: number }> = {};
	if (!isObject(raw)) return out;
	for (const [id, v] of Object.entries(raw)) {
		if (!isObject(v) || typeof v.at !== "number") continue;
		// Too old, or dated further ahead than the TTL (the clock went back).
		if (!Number.isFinite(v.at) || Math.abs(now - v.at) >= PENDING_TTL_MS)
			continue;
		out[id] = { usd: nonNegative(v.usd), at: v.at };
	}
	return out;
}

const reserved = (s: Spend) =>
	Object.values(s.pending).reduce((sum, p) => sum + p.usd, 0);

/**
 * Today's totals: a stored day or month that is not the current one reads as
 * 0. A record written before reservations existed has no `pending`: it reads
 * as none, and its totals carry on. Throws if the store cannot be read.
 */
export async function loadSpend(io: Io): Promise<Spend> {
	const nowMs = await io.now();
	const { day, month } = keysOf(nowMs);
	// A store that cannot be read throws: the caller fails closed. A value
	// that reads but makes no sense counts as nothing spent.
	const raw = await io.storeGet(SPEND_KEY);
	const s = isObject(raw) ? raw : {};
	return {
		day,
		dayUsd: s.day === day ? nonNegative(s.dayUsd) : 0,
		month,
		monthUsd: s.month === month ? nonNegative(s.monthUsd) : 0,
		pending: livePending(s.pending, nowMs),
	};
}

/** Put this call's estimate on file before its fetch starts. */
async function reserve(
	io: Io,
	id: string,
	usd: number,
	at: number,
): Promise<void> {
	const s = await loadSpend(io);
	await io.storeSet(SPEND_KEY, {
		...s,
		pending: { ...s.pending, [id]: { usd, at } },
	});
}

/**
 * What this session spent that the store has not taken: costs whose write
 * failed, by the day and month they belong to. It is a floor under the stored
 * totals, so a store that stops accepting writes cannot hide spend.
 */
export type Ledger = {
	day: string;
	month: string;
	dayUsd: number;
	monthUsd: number;
};

export const newLedger = (): Ledger => ({
	day: "",
	month: "",
	dayUsd: 0,
	monthUsd: 0,
});

/** The ledger's share of the given day and month. */
const unsaved = (l: Ledger, day: string, month: string) => ({
	dayUsd: l.day === day ? l.dayUsd : 0,
	monthUsd: l.month === month ? l.monthUsd : 0,
});

/** Swap this call's reservation for what it really cost. */
async function settle(
	io: Io,
	ledger: Ledger,
	id: string,
	costUsd: number,
	at: number,
): Promise<void> {
	try {
		const s = await loadSpend(io);
		const { [id]: _done, ...rest } = s.pending;
		const u = unsaved(ledger, s.day, s.month);
		await io.storeSet(SPEND_KEY, {
			...s,
			dayUsd: s.dayUsd + costUsd + u.dayUsd,
			monthUsd: s.monthUsd + costUsd + u.monthUsd,
			pending: rest,
		});
		ledger.dayUsd = 0;
		ledger.monthUsd = 0;
	} catch {
		// Keep the cost here rather than turn a finished call into an error.
		// Keyed by the reservation's own time (from `io.now()` when it was made),
		// so the dates agree with the clock the store uses.
		const { day, month } = keysOf(at);
		const u = unsaved(ledger, day, month);
		ledger.day = day;
		ledger.month = month;
		ledger.dayUsd = u.dayUsd + costUsd;
		ledger.monthUsd = u.monthUsd + costUsd;
	}
}

let requestSeq = 0;

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

function scoreAnswer(
	v: unknown,
	d: Dimension,
	questions: Questions,
): ScoreAnswer | undefined {
	if (!isObject(v) || v.type !== "score") return undefined;
	const probs = probabilities(v.probabilities);
	if (!num(v.score) || !num(v.confidence) || !probs) return undefined;
	const top = levelCount(d, questions) - 1;
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
function checkAnswers(
	parsed: unknown,
	questions: Questions,
): Answers | undefined {
	if (!isObject(parsed) || !isObject(parsed.answers)) return undefined;
	const a = parsed.answers;
	const task_type = choiceAnswer(a.task_type);
	if (!task_type) return undefined;
	const dims: Partial<Record<Dimension, ScoreAnswer>> = {};
	for (const d of DIMENSIONS) {
		const s = scoreAnswer(a[d], d, questions);
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
	ledger: Ledger,
	rubric: Rubric = RUBRIC,
): Promise<JevOutcome> {
	if (config.apiKey === undefined) return { kind: "key-rejected" };
	// Never rejects: before a reservation exists a failure means no call is
	// made (budget, fail closed); after it, the call may be on its way (offline).
	const stage = { reserved: false };
	try {
		return await call(io, config, state, ledger, stage, rubric);
	} catch {
		return { kind: stage.reserved ? "offline" : "budget" };
	}
}

async function call(
	io: Io,
	config: Config,
	state: JevState,
	ledger: Ledger,
	stage: { reserved: boolean },
	rubric: Rubric,
): Promise<JevOutcome> {
	const apiKey = config.apiKey;
	const body = JSON.stringify({
		model: config.model,
		state,
		questions: rubric.questions,
		...(config.requireZdr ? { provider: { zdr: true } } : {}),
	});
	const estimate = (bytes(body) / 3) * (config.priceUsdPerMTok / 1e6);

	// Fail closed: a store that cannot be read or written stops grading.
	const at = await io.now();
	const id = `${at}-${++requestSeq}-${Math.random().toString(36).slice(2, 8)}`;
	const spend = await loadSpend(io);
	const held = reserved(spend);
	const u = unsaved(ledger, spend.day, spend.month);
	if (
		spend.dayUsd + held + u.dayUsd + estimate > config.dailyBudgetUsd ||
		spend.monthUsd + held + u.monthUsd + estimate > config.monthlyBudgetUsd
	) {
		return { kind: "budget" };
	}
	await reserve(io, id, estimate, at);
	stage.reserved = true;

	// $.http.fetch cannot be aborted, so the fetch runs on and settles its own
	// reservation whenever it lands; the timeout only decides what we return now.
	const fetched: Promise<Settled> = (async () => {
		let res: Awaited<ReturnType<Io["fetch"]>> | undefined;
		try {
			res = await io.fetch(URL, {
				method: "POST",
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				body,
			});
		} catch {
			res = undefined;
		}
		if (!res || typeof res.text !== "string") {
			await settle(io, ledger, id, estimate, at);
			return { offline: true };
		}
		await settle(io, ledger, id, costOf(parseJson(res.text)) ?? estimate, at);
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
		const answers = checkAnswers(parsed, rubric.questions);
		if (answers) {
			return {
				kind: "ok",
				answers,
				costUsd: costOf(parsed) ?? estimate,
				model: modelOf(parsed),
			};
		}
	}
	try {
		io.log(settled.text);
	} catch {
		// A log that fails must not hide the outcome.
	}
	return { kind: "unexpected", body: settled.text };
}

/** The response's `model` field, when it is a non-empty string. */
function modelOf(parsed: unknown): string | undefined {
	const m = (parsed as { model?: unknown } | null)?.model;
	return typeof m === "string" && m !== "" ? m : undefined;
}
