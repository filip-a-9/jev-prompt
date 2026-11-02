import { describe, expect, test } from "claude-code/testing";
import { DEFAULTS } from "../src/config";
import {
	type Io,
	jevCall,
	type Ledger,
	loadSpend,
	newLedger,
	SPEND_KEY,
} from "../src/jev";
import { QUESTIONS, RUBRIC } from "../src/rubric";
import type { Config, JevState, Rubric, Spend } from "../src/types";
import { badKey } from "./fixtures/bad-key";
import { bugfixNozdr } from "./fixtures/bugfix-nozdr";
import { bugfixZdr } from "./fixtures/bugfix-zdr";
import { followupZdr } from "./fixtures/followup-zdr";

// Local noon on 2 Nov 2026, built with the local constructor so the expected
// date strings below hold in any time zone.
const NOON = new Date(2026, 10, 2, 12, 0, 0).getTime();
const LATE_NEW_YEAR_EVE = new Date(2026, 11, 31, 23, 59, 0).getTime();

const STATE: JevState = {
	draft: "fix the login bug",
	previous_user_prompt: "",
	last_assistant_reply: "",
	project_instructions: "",
};

const config = (over: Partial<Config> = {}): Config => ({
	...DEFAULTS,
	apiKey: "sk-test",
	...over,
});

type Reply =
	| { status: number; body: unknown }
	| { status: number; text: string }
	| "reject"
	| "null";

const textOf = (r: { body: unknown } | { text: string }) =>
	"text" in r ? r.text : JSON.stringify(r.body);

/**
 * A hand-made world behind the `Io` the code under test takes: a clock that
 * moves only on `advance`, a JSON store, a network that answers as told, and a
 * log. (The test kit's `$` carries no clock, store or network, and a hooks
 * module may not pass `$` around, so the code takes closures instead.)
 */
function world(
	opts: {
		now?: number;
		spend?: unknown;
		reply?: Reply;
		/** answer only after this many ms of mocked time */
		delayMs?: number;
		/** runs when a request goes out, before it is answered */
		onFetch?: () => void;
	} = {},
) {
	const fail = {
		get: false,
		set: false,
		now: false,
		after: false,
		log: false,
	};
	let now = opts.now ?? NOON;
	const timers: { at: number; fn: () => void; live: boolean }[] = [];
	const after = (ms: number, fn: () => void) => {
		if (fail.after) throw new Error("timers unavailable");
		const t = { at: now + ms, fn, live: true };
		timers.push(t);
		return {
			cancel: () => {
				t.live = false;
			},
		};
	};
	const settle = async () => {
		for (let i = 0; i < 50; i++) await Promise.resolve();
	};
	const clock = {
		advance: async (ms: number) => {
			await settle(); // let what is already under way register its timers
			const target = now + ms;
			for (;;) {
				const due = timers
					.filter((t) => t.live && t.at <= target)
					.sort((x, y) => x.at - y.at)[0];
				if (!due) break;
				due.live = false;
				now = due.at;
				due.fn();
				await settle();
			}
			now = target;
			await settle();
		},
	};
	const store = new Map<string, string>();
	if (opts.spend !== undefined)
		store.set(SPEND_KEY, JSON.stringify(opts.spend));
	const requests: { url: string; init: Record<string, unknown> }[] = [];
	const logs: string[] = [];
	const io: Io = {
		fetch: async (url, init) => {
			requests.push({ url, init: { ...init } });
			opts.onFetch?.();
			if (opts.delayMs !== undefined)
				await new Promise<void>((r) => after(opts.delayMs as number, r));
			const reply = opts.reply ?? { status: 200, body: {} };
			if (reply === "reject") throw new Error("socket hang up");
			// A fetch that answers with nothing (outside the Io type on purpose).
			if (reply === "null") return null as never;
			return {
				status: reply.status,
				ok: reply.status >= 200 && reply.status < 300,
				headers: {},
				text: textOf(reply),
			};
		},
		now: async () => {
			if (fail.now) throw new Error("clock unavailable");
			return now;
		},
		after,
		storeGet: async (key) => {
			if (fail.get) throw new Error("store unreadable");
			const v = store.get(key);
			return v === undefined ? undefined : JSON.parse(v);
		},
		storeSet: async (key, value) => {
			if (fail.set) throw new Error("store unwritable");
			store.set(key, JSON.stringify(value));
		},
		log: (text) => {
			if (fail.log) throw new Error("log unavailable");
			logs.push(text);
		},
	};
	const stored = () => {
		const v = store.get(SPEND_KEY);
		return v === undefined ? undefined : JSON.parse(v);
	};
	return { io, clock, requests, logs, stored, fail };
}

const bodyOf = (r: { init: Record<string, unknown> }) =>
	JSON.parse(String(r.init.body));
const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("budget gate", () => {
	test("a call within both budgets goes out once", async () => {
		const w = world();
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
	});

	test("daily budget already spent: budget, no request", async () => {
		const w = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0.1,
				month: "2026-11",
				monthUsd: 0.1,
			},
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("monthly budget already spent: budget, no request", async () => {
		const w = world({
			spend: { day: "2026-11-02", dayUsd: 0, month: "2026-11", monthUsd: 1.65 },
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("the estimate counts: a call that would cross the daily cap is refused, one that fits is not", async () => {
		// Probe the real request size first, then place the cap 1 byte-worth either side.
		const probe = world();
		await jevCall(probe.io, config(), STATE, newLedger());
		const first = probe.requests[0];
		if (!first) throw new Error("probe made no request");
		const estimate = (bytes(String(first.init.body)) / 3) * (0.042 / 1e6);

		const over = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0.1 - estimate * 0.9,
				month: "2026-11",
				monthUsd: 0,
			},
		});
		expect(await jevCall(over.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(over.requests).toHaveLength(0);

		const fits = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0.1 - estimate * 1.1,
				month: "2026-11",
				monthUsd: 0,
			},
		});
		await jevCall(fits.io, config(), STATE, newLedger());
		expect(fits.requests).toHaveLength(1);
	});

	test("the estimate counts against the monthly cap too", async () => {
		const probe = world();
		await jevCall(probe.io, config(), STATE, newLedger());
		const first = probe.requests[0];
		if (!first) throw new Error("probe made no request");
		const estimate = (bytes(String(first.init.body)) / 3) * (0.042 / 1e6);
		const w = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0,
				month: "2026-11",
				monthUsd: 1.65 - estimate * 0.9,
			},
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});
});

describe("stored totals", () => {
	test("a new day starts the day total at 0 and keeps the month", async () => {
		const w = world({
			spend: { day: "2026-11-01", dayUsd: 5, month: "2026-11", monthUsd: 0.5 },
			reply: { status: 200, body: { usage: { cost: 0.001 } } },
		});
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
		const s = w.stored() as Spend;
		expect(s.day).toBe("2026-11-02");
		expect(s.dayUsd).toBe(0.001);
		expect(s.month).toBe("2026-11");
		expect(s.monthUsd).toBe(0.501);
	});

	test("a new month starts both totals at 0", async () => {
		const w = world({
			spend: { day: "2026-10-02", dayUsd: 5, month: "2026-10", monthUsd: 50 },
			reply: { status: 200, body: { usage: { cost: 0.001 } } },
		});
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
		const s = w.stored() as Spend;
		expect(s).toEqual({
			day: "2026-11-02",
			dayUsd: 0.001,
			month: "2026-11",
			monthUsd: 0.001,
			pending: {},
		});
	});

	test("dates are local: 23:59 on 31 Dec is still that day and month", async () => {
		const w = world({
			now: LATE_NEW_YEAR_EVE,
			reply: { status: 200, body: { usage: { cost: 0.002 } } },
		});
		await jevCall(w.io, config(), STATE, newLedger());
		const s = w.stored() as Spend;
		expect(s.day).toBe("2026-12-31");
		expect(s.month).toBe("2026-12");
	});

	for (const [name, junk] of [
		["a string", "garbage"],
		["null", null],
		["an array", []],
		["a number", 7],
		["wrong field types", { day: 1, dayUsd: "a", month: {}, monthUsd: null }],
		[
			"negative totals",
			{ day: "2026-11-02", dayUsd: -5, month: "2026-11", monthUsd: -5 },
		],
	] as const) {
		test(`garbled stored data (${name}) counts as nothing spent and does not throw`, async () => {
			const w = world({
				spend: junk,
				reply: { status: 200, body: { usage: { cost: 0.001 } } },
			});
			await jevCall(w.io, config(), STATE, newLedger());
			expect(w.requests).toHaveLength(1);
			const s = w.stored() as Spend;
			expect(s.dayUsd).toBe(0.001);
			expect(s.monthUsd).toBe(0.001);
		});
	}
});

describe("loadSpend", () => {
	test("totals from today are returned as stored", async () => {
		const w = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0.03,
				month: "2026-11",
				monthUsd: 0.4,
			},
		});
		expect(await loadSpend(w.io)).toEqual({
			day: "2026-11-02",
			dayUsd: 0.03,
			month: "2026-11",
			monthUsd: 0.4,
			pending: {},
		});
	});

	test("a stale day reads as 0 for the day, the month is kept", async () => {
		const w = world({
			spend: {
				day: "2026-11-01",
				dayUsd: 0.09,
				month: "2026-11",
				monthUsd: 0.4,
			},
		});
		expect(await loadSpend(w.io)).toEqual({
			day: "2026-11-02",
			dayUsd: 0,
			month: "2026-11",
			monthUsd: 0.4,
			pending: {},
		});
	});

	test("a stale month reads as 0 for both", async () => {
		const w = world({
			spend: {
				day: "2026-10-31",
				dayUsd: 0.09,
				month: "2026-10",
				monthUsd: 1.5,
			},
		});
		expect(await loadSpend(w.io)).toEqual({
			day: "2026-11-02",
			dayUsd: 0,
			month: "2026-11",
			monthUsd: 0,
			pending: {},
		});
	});

	test("nothing stored reads as 0 and writes nothing", async () => {
		const w = world();
		expect((await loadSpend(w.io)).dayUsd).toBe(0);
		expect(w.stored()).toBeUndefined();
	});
});

describe("a broken store fails closed", () => {
	test("an unreadable store is budget, and no request goes out", async () => {
		const w = world();
		w.fail.get = true;
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("a reservation that cannot be written is budget, and no request goes out", async () => {
		const w = world();
		w.fail.set = true;
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("a cost that could not be written still counts, and is written with the next one", async () => {
		const ledger: Ledger = newLedger();
		const ref: { w?: ReturnType<typeof world> } = {};
		const w = world({
			reply: { status: 200, body: { usage: { cost: 0.05 } } },
			onFetch: () => {
				if (ref.w) ref.w.fail.set = true; // the write after the call fails
			},
		});
		ref.w = w;
		const cap = config({ dailyBudgetUsd: 0.05, monthlyBudgetUsd: 10 });
		expect((await jevCall(w.io, cap, STATE, ledger)).kind).not.toBe("budget");
		w.fail.set = false;

		// The store knows nothing of the 0.05, the session ledger does.
		expect(await jevCall(w.io, cap, STATE, ledger)).toEqual({ kind: "budget" });
		expect(w.requests).toHaveLength(1);

		const wide = config({ dailyBudgetUsd: 10, monthlyBudgetUsd: 10 });
		const again = world({
			reply: { status: 200, body: { usage: { cost: 0.25 } } },
		});
		await jevCall(again.io, wide, STATE, ledger);
		expect((again.stored() as Spend).dayUsd).toBe(0.3);
	});

	test("a clock that fails while the call settles does not make jevCall reject, and the cost still counts for its own day", async () => {
		const ledger = newLedger();
		const ref: { w?: ReturnType<typeof world> } = {};
		// Not today's real date, so only the reservation's own timestamp can key it.
		const w = world({
			now: LATE_NEW_YEAR_EVE,
			reply: { status: 200, body: { usage: { cost: 0.05 } } },
			onFetch: () => {
				if (ref.w) ref.w.fail.now = true;
			},
		});
		ref.w = w;
		const cap = config({ dailyBudgetUsd: 0.05, monthlyBudgetUsd: 10 });
		const out = await jevCall(w.io, cap, STATE, ledger);
		expect(out.kind).not.toBe("budget");
		w.fail.now = false;
		expect(await jevCall(w.io, cap, STATE, ledger)).toEqual({ kind: "budget" });
		expect(w.requests).toHaveLength(1);
	});

	test("garbled stored data still reads as 0, not as a failure", async () => {
		const w = world({ spend: "garbage" });
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
	});
});

describe("jevCall never rejects", () => {
	test("a clock that fails before anything is reserved: budget, no request", async () => {
		const w = world();
		w.fail.now = true;
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("timers that throw after the reservation: offline", async () => {
		const w = world();
		w.fail.after = true;
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "offline",
		});
	});

	test("a log that throws on an unexpected answer: still unexpected", async () => {
		const w = world({ reply: { status: 500, text: "boom" } });
		w.fail.log = true;
		expect((await jevCall(w.io, config(), STATE, newLedger())).kind).toBe(
			"unexpected",
		);
	});

	test("a fetch that resolves to nothing: offline, and the reservation is settled", async () => {
		const w = world({ reply: "null" });
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "offline",
		});
		expect((w.stored() as Spend).pending).toEqual({});
	});
});

describe("pending reservations", () => {
	const old = (extra: Record<string, unknown> = {}) => ({
		day: "2026-11-02",
		dayUsd: 0.5,
		month: "2026-11",
		monthUsd: 1,
		...extra,
	});

	test("a stored total without a pending map (the old shape) keeps its running total", async () => {
		const w = world({
			spend: old(),
			reply: { status: 200, body: { usage: { cost: 0.25 } } },
		});
		expect(await loadSpend(w.io)).toEqual({
			day: "2026-11-02",
			dayUsd: 0.5,
			month: "2026-11",
			monthUsd: 1,
			pending: {},
		});
		await jevCall(
			w.io,
			config({ dailyBudgetUsd: 10, monthlyBudgetUsd: 10 }),
			STATE,
			newLedger(),
		);
		const s = w.stored() as Spend;
		expect(s.dayUsd).toBe(0.75);
		expect(s.monthUsd).toBe(1.25);
		expect(s.pending).toEqual({});
	});

	test("a recent reservation from another request counts against the cap", async () => {
		const w = world({
			spend: old({
				dayUsd: 0,
				monthUsd: 0,
				pending: { other: { usd: 0.1, at: NOON - 1000 } },
			}),
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
		expect(w.requests).toHaveLength(0);
	});

	test("a reservation dated far in the future (the clock went back) is dropped, not counted", async () => {
		const w = world({
			spend: old({
				dayUsd: 0,
				monthUsd: 0,
				pending: { future: { usd: 0.1, at: NOON + 11 * 60_000 } },
			}),
		});
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
	});

	test("a reservation a little in the future still counts", async () => {
		const w = world({
			spend: old({
				dayUsd: 0,
				monthUsd: 0,
				pending: { skew: { usd: 0.1, at: NOON + 1000 } },
			}),
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "budget",
		});
	});

	test("a reservation older than ten minutes is dropped, not counted", async () => {
		const w = world({
			spend: old({
				dayUsd: 0,
				monthUsd: 0,
				pending: { stale: { usd: 0.1, at: NOON - 11 * 60_000 } },
			}),
		});
		await jevCall(w.io, config(), STATE, newLedger());
		expect(w.requests).toHaveLength(1);
	});
});

describe("request", () => {
	test("POSTs to the decisions endpoint with bearer key and JSON content type", async () => {
		const w = world();
		await jevCall(w.io, config({ apiKey: "sk-abc" }), STATE, newLedger());
		const r = w.requests[0];
		expect(r?.url).toBe("https://openrouter.ai/api/alpha/decisions");
		expect(r?.init.method).toBe("POST");
		expect(r?.init.headers).toEqual({
			authorization: "Bearer sk-abc",
			"content-type": "application/json",
		});
	});

	test("body carries model, state and the rubric questions", async () => {
		const w = world();
		await jevCall(
			w.io,
			config({ model: "typesafe/jev-9.9" }),
			STATE,
			newLedger(),
		);
		const b = bodyOf(w.requests[0] as { init: Record<string, unknown> });
		expect(b.model).toBe("typesafe/jev-9.9");
		expect(b.state).toEqual(STATE);
		expect(b.questions).toEqual(JSON.parse(JSON.stringify(QUESTIONS)));
	});

	test("requireZdr on: body asks for zero data retention", async () => {
		const w = world();
		await jevCall(w.io, config({ requireZdr: true }), STATE, newLedger());
		const b = bodyOf(w.requests[0] as { init: Record<string, unknown> });
		expect(b.provider).toEqual({ zdr: true });
	});

	test("requireZdr off: body has no provider field", async () => {
		const w = world();
		await jevCall(w.io, config({ requireZdr: false }), STATE, newLedger());
		const b = bodyOf(w.requests[0] as { init: Record<string, unknown> });
		expect("provider" in b).toBe(false);
	});

	test("no api key: no request, key-rejected, nothing recorded", async () => {
		const w = world();
		const out = await jevCall(
			w.io,
			config({ apiKey: undefined }),
			STATE,
			newLedger(),
		);
		expect(out).toEqual({ kind: "key-rejected" });
		expect(w.requests).toHaveLength(0);
		expect(w.stored()).toBeUndefined();
	});
});

describe("recording the cost", () => {
	test("usage.cost is added to both totals", async () => {
		const w = world({
			spend: {
				day: "2026-11-02",
				dayUsd: 0.01,
				month: "2026-11",
				monthUsd: 0.5,
			},
			reply: { status: 200, body: { usage: { cost: 0.25 } } },
		});
		await jevCall(
			w.io,
			config({ dailyBudgetUsd: 10, monthlyBudgetUsd: 10 }),
			STATE,
			newLedger(),
		);
		const s = w.stored() as Spend;
		expect(s.dayUsd).toBe(0.26);
		expect(s.monthUsd).toBe(0.75);
	});

	for (const [name, usage] of [
		["no usage", undefined],
		["a negative cost", { cost: -1 }],
		["a non-number cost", { cost: "0.5" }],
	] as const) {
		test(`${name}: the estimate is recorded instead`, async () => {
			const w = world({
				reply: { status: 200, body: usage === undefined ? {} : { usage } },
			});
			await jevCall(w.io, config(), STATE, newLedger());
			const sent = String(
				(w.requests[0] as { init: Record<string, unknown> }).init.body,
			);
			const estimate = (bytes(sent) / 3) * (0.042 / 1e6);
			const s = w.stored() as Spend;
			expect(Math.abs(s.dayUsd - estimate)).toBeLessThan(1e-12);
			expect(Math.abs(s.monthUsd - estimate)).toBeLessThan(1e-12);
		});
	}

	test("an error response that carries a cost still records it", async () => {
		const w = world({
			reply: { status: 500, body: { usage: { cost: 0.003 } } },
		});
		await jevCall(w.io, config(), STATE, newLedger());
		const s = w.stored() as Spend;
		expect(s.dayUsd).toBe(0.003);
	});

	test("a network failure records the estimate and is offline", async () => {
		const w = world({ reply: "reject" });
		const out = await jevCall(w.io, config(), STATE, newLedger());
		expect(out).toEqual({ kind: "offline" });
		const sent = String(
			(w.requests[0] as { init: Record<string, unknown> }).init.body,
		);
		const estimate = (bytes(sent) / 3) * (0.042 / 1e6);
		const s = w.stored() as Spend;
		expect(Math.abs(s.dayUsd - estimate)).toBeLessThan(1e-12);
	});
});

describe("timeout", () => {
	test("a response slower than timeoutMs is offline; its real cost is recorded when it lands", async () => {
		const w = world({
			delayMs: 5000,
			reply: { status: 200, body: { usage: { cost: 0.004 } } },
		});
		let outcome: unknown;
		const call = jevCall(
			w.io,
			config({ timeoutMs: 3000 }),
			STATE,
			newLedger(),
		).then((o) => {
			outcome = o;
		});
		await w.clock.advance(2999);
		expect(outcome).toBeUndefined();
		await w.clock.advance(1);
		await call;
		expect(outcome).toEqual({ kind: "offline" });
		// Nothing is settled yet: only the reserved estimate is on file.
		const mid = w.stored() as Spend;
		expect(mid.dayUsd).toBe(0);
		expect(Object.keys(mid.pending)).toHaveLength(1);

		await w.clock.advance(2000);
		const s = w.stored() as Spend;
		expect(s.dayUsd).toBe(0.004);
		expect(s.monthUsd).toBe(0.004);
		expect(s.pending).toEqual({});
	});

	test("a second call after a timeout is gated on the first one's estimate", async () => {
		const probe = world();
		await jevCall(probe.io, config(), STATE, newLedger());
		const first = probe.requests[0];
		if (!first) throw new Error("probe made no request");
		const estimate = (bytes(String(first.init.body)) / 3) * (0.042 / 1e6);

		// Room for one estimate, not for two.
		const cfg = config({ timeoutMs: 3000, dailyBudgetUsd: estimate * 1.5 });
		const w = world({
			delayMs: 5000,
			reply: { status: 200, body: { usage: { cost: 0.0000001 } } },
		});
		const ledger = newLedger();
		const call = jevCall(w.io, cfg, STATE, ledger);
		await w.clock.advance(3000);
		expect(await call).toEqual({ kind: "offline" });

		expect(await jevCall(w.io, cfg, STATE, ledger)).toEqual({ kind: "budget" });
		expect(w.requests).toHaveLength(1);
	});

	test("a response inside timeoutMs wins the race", async () => {
		const w = world({
			delayMs: 1000,
			reply: { status: 429, body: {} },
		});
		const call = jevCall(w.io, config({ timeoutMs: 3000 }), STATE, newLedger());
		await w.clock.advance(1000);
		expect(await call).toEqual({ kind: "rate-limited" });
	});
});

describe("status mapping", () => {
	for (const status of [401, 403]) {
		test(`${status} is key-rejected`, async () => {
			const w = world({
				reply: { status, body: { error: { code: status, message: "x" } } },
			});
			expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
				kind: "key-rejected",
			});
		});
	}

	test("429 is rate-limited", async () => {
		const w = world({
			reply: { status: 429, body: { error: { code: 429, message: "x" } } },
		});
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "rate-limited",
		});
	});
});

describe("unexpected responses", () => {
	for (const [name, reply] of [
		[
			"a 500 with an error envelope",
			{ status: 500, text: '{"error":{"code":500,"message":"boom"}}' },
		],
		["a 200 that is not JSON", { status: 200, text: "<html>gateway</html>" }],
		["a 200 with an empty object", { status: 200, text: "{}" }],
		["a 200 holding a JSON array", { status: 200, text: "[1,2]" }],
	] as const) {
		test(`${name}: unexpected with the full body, also logged`, async () => {
			const w = world({ reply });
			expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
				kind: "unexpected",
				body: reply.text,
			});
			expect(w.logs.some((l) => l.includes(reply.text))).toBe(true);
		});
	}
});

// Real responses captured from OpenRouter; the expected values below are read
// off those files by hand.
type Fixture = { status: number; body: unknown };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("answers from captured responses", () => {
	for (const [name, fx, choice, goal, replyFit, cost] of [
		["bugfix with zdr", bugfixZdr, "bug_fix", 2.89, undefined, 6.3504e-5],
		["follow-up with zdr", followupZdr, "follow_up", 2.55, 1.89, 6.0144e-5],
		["bugfix without zdr", bugfixNozdr, "bug_fix", 2.88, 1.19, 6.3504e-5],
	] as const) {
		test(`${name}: ok with the answers and the billed cost`, async () => {
			const w = world({ reply: fx as Fixture });
			const out = await jevCall(w.io, config(), STATE, newLedger());
			if (out.kind !== "ok") throw new Error(`got ${out.kind}`);
			expect(out.costUsd).toBe(cost);
			expect(out.answers.task_type.choice).toBe(choice);
			expect(out.answers.goal.score).toBe(goal);
			if (replyFit !== undefined) {
				expect(out.answers.reply_fit.score).toBe(replyFit);
			}
			expect(Object.keys(out.answers).sort()).toEqual(
				[
					"task_type",
					"goal",
					"context",
					"verification",
					"constraints",
					"evidence",
					"focus",
					"rationale",
					"output",
					"reply_fit",
				].sort(),
			);
			expect(w.stored()?.dayUsd).toBe(cost);
		});
	}

	test("only the declared fields are returned: no legend", async () => {
		const w = world({ reply: bugfixZdr as Fixture });
		const out = await jevCall(w.io, config(), STATE, newLedger());
		if (out.kind !== "ok") throw new Error(`got ${out.kind}`);
		expect(Object.keys(out.answers.goal).sort()).toEqual([
			"confidence",
			"probabilities",
			"score",
			"type",
		]);
		expect(out.answers.goal.probabilities).toEqual({
			"0": 0,
			"1": 0,
			"2": 0.11,
			"3": 0.89,
		});
		expect(out.answers.task_type.probabilities.bug_fix).toBe(0.97);
	});

	test("a confidence of 0 is valid", async () => {
		const w = world({ reply: bugfixZdr as Fixture });
		const out = await jevCall(w.io, config(), STATE, newLedger());
		if (out.kind !== "ok") throw new Error(`got ${out.kind}`);
		expect(out.answers.reply_fit.confidence).toBe(0);
	});

	test("bad-key fixture is key-rejected", async () => {
		const w = world({ reply: badKey as Fixture });
		expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
			kind: "key-rejected",
		});
	});

	// biome-ignore lint/suspicious/noExplicitAny: mutating parsed JSON
	type Doc = any;
	const ill: [string, (b: Doc) => void][] = [
		["a dimension is missing", (b) => delete b.answers.focus],
		["task_type is missing", (b) => delete b.answers.task_type],
		["answers is missing", (b) => delete b.answers],
		[
			"task_type has the score type",
			(b) => (b.answers.task_type.type = "score"),
		],
		[
			"a dimension has the choice type",
			(b) => (b.answers.goal.type = "choice"),
		],
		["choice is not a string", (b) => (b.answers.task_type.choice = 3)],
		["score is a string", (b) => (b.answers.goal.score = "2.89")],
		["score is null", (b) => (b.answers.goal.score = null)],
		["score is far above the top level", (b) => (b.answers.goal.score = 4)],
		[
			"score on a 3-level dimension exceeds 2",
			(b) => (b.answers.focus.score = 3),
		],
		["score is negative", (b) => (b.answers.goal.score = -0.5)],
		["confidence is missing", (b) => delete b.answers.goal.confidence],
		["confidence is a string", (b) => (b.answers.goal.confidence = "high")],
		["probabilities is missing", (b) => delete b.answers.goal.probabilities],
		[
			"a probability is not a number",
			(b) => (b.answers.goal.probabilities["2"] = "x"),
		],
		[
			"probabilities is an array",
			(b) => (b.answers.task_type.probabilities = []),
		],
	];
	for (const [name, mutate] of ill) {
		test(`ill-shaped (${name}): unexpected with the full body, logged`, async () => {
			const body = clone(bugfixZdr.body);
			mutate(body);
			const text = JSON.stringify(body);
			const w = world({ reply: { status: 200, text } });
			expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
				kind: "unexpected",
				body: text,
			});
			expect(w.logs).toContain(text);
			// the call was billed all the same
			expect(w.stored()?.dayUsd).toBe(6.3504e-5);
		});
	}

	test("a score a hair outside its range is clamped to the range", async () => {
		const body = clone(bugfixZdr.body) as Doc;
		body.answers.goal.score = 3.004;
		body.answers.focus.score = -0.004;
		const w = world({ reply: { status: 200, text: JSON.stringify(body) } });
		const out = await jevCall(w.io, config(), STATE, newLedger());
		if (out.kind !== "ok") throw new Error(`got ${out.kind}`);
		expect(out.answers.goal.score).toBe(3);
		expect(out.answers.focus.score).toBe(0);
	});
});

describe("zdr refusal", () => {
	// Not captured: ZDR was honoured in every capture. This is the shape
	// OpenRouter documents for a provider requirement nobody can meet.
	const refusal = (status: number, message: string) => ({
		status,
		body: { error: { code: status, message } },
	});

	for (const message of [
		"No endpoints found matching your data policy (Zero data retention).",
		"no allowed providers: ZDR is required",
	]) {
		test(`404 saying "${message.slice(0, 24)}..." is zdr-unavailable`, async () => {
			const w = world({ reply: refusal(404, message) });
			expect(await jevCall(w.io, config(), STATE, newLedger())).toEqual({
				kind: "zdr-unavailable",
			});
		});
	}

	test("a 404 about something else stays unexpected", async () => {
		const w = world({ reply: refusal(404, "Model not found") });
		expect((await jevCall(w.io, config(), STATE, newLedger())).kind).toBe(
			"unexpected",
		);
	});

	test("the same words on another status stay unexpected", async () => {
		const w = world({ reply: refusal(400, "data policy violation") });
		expect((await jevCall(w.io, config(), STATE, newLedger())).kind).toBe(
			"unexpected",
		);
	});
});

describe("a custom rubric", () => {
	const rubric: Rubric = {
		weights: RUBRIC.weights,
		questions: {
			...QUESTIONS,
			context: {
				type: "score",
				instructions: "x",
				criteria: ["a", "b", "c", "d", "e"],
			},
		},
	};

	test("the request body carries that rubric's questions", async () => {
		const w = world();
		await jevCall(w.io, config(), STATE, newLedger(), rubric);
		const b = bodyOf(w.requests[0] as { init: Record<string, unknown> });
		expect(b.questions).toEqual(JSON.parse(JSON.stringify(rubric.questions)));
	});

	// bugfix-zdr with only the context score changed to 4 (top of 5 levels).
	const reply = () => {
		const body = clone(bugfixZdr.body);
		body.answers.context.score = 4;
		return { status: 200, text: JSON.stringify(body) };
	};

	test("a context score of 4 is accepted under a 5-level context question", async () => {
		const w = world({ reply: reply() });
		const out = await jevCall(w.io, config(), STATE, newLedger(), rubric);
		if (out.kind !== "ok") throw new Error(`got ${out.kind}`);
		expect(out.answers.context.score).toBe(4);
	});

	test("the same score of 4 is unexpected under the default rubric", async () => {
		const w = world({ reply: reply() });
		const out = await jevCall(w.io, config(), STATE, newLedger());
		expect(out.kind).toBe("unexpected");
	});
});
