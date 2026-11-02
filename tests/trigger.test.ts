import { describe, expect, test } from "claude-code/testing";
import {
	createDebounce,
	createSingleFlight,
	decide,
	type Schedule,
} from "../src/trigger";

/** A hand clock: timers fire only when the test calls `advance`. */
function fakeSchedule() {
	let now = 0;
	const timers: { at: number; fn: () => void; live: boolean }[] = [];
	const schedule: Schedule = (ms, fn) => {
		const t = { at: now + ms, fn, live: true };
		timers.push(t);
		return {
			cancel: () => {
				t.live = false;
			},
		};
	};
	const advance = (ms: number) => {
		now += ms;
		for (const t of timers) {
			if (t.live && t.at <= now) {
				t.live = false;
				t.fn();
			}
		}
	};
	return { schedule, advance };
}

describe("debounce", () => {
	test("fires once after the idle time, not before", () => {
		const clock = fakeSchedule();
		let fired = 0;
		const d = createDebounce();
		const start = () =>
			clock.schedule(10000, () => {
				fired += 1;
			});
		d.edited("fix the bug", start);
		clock.advance(9999);
		expect(fired).toBe(0);
		clock.advance(1);
		expect(fired).toBe(1);
	});

	test("each edit restarts the wait", () => {
		const clock = fakeSchedule();
		let fired = 0;
		const d = createDebounce();
		const start = () =>
			clock.schedule(10000, () => {
				fired += 1;
			});
		d.edited("fix", start);
		clock.advance(6000);
		d.edited("fix the", start);
		clock.advance(6000);
		expect(fired).toBe(0);
		clock.advance(4000);
		expect(fired).toBe(1);
	});

	test("an edit that leaves the text unchanged does not restart the wait", () => {
		const clock = fakeSchedule();
		let fired = 0;
		const d = createDebounce();
		const start = () =>
			clock.schedule(10000, () => {
				fired += 1;
			});
		d.edited("fix the bug", start);
		clock.advance(6000);
		d.edited("fix the bug", start);
		clock.advance(4000);
		expect(fired).toBe(1);
	});

	test("cancel stops a pending fire", () => {
		const clock = fakeSchedule();
		let fired = 0;
		const d = createDebounce();
		const start = () =>
			clock.schedule(10000, () => {
				fired += 1;
			});
		d.edited("fix the bug", start);
		d.cancel();
		clock.advance(20000);
		expect(fired).toBe(0);
	});
});

describe("decide", () => {
	const base = {
		minChars: 10,
		requireEndPunctuation: false,
		promptCommands: ["goal", "loop"],
	};

	test("a draft under minChars after trimming hides the band", () => {
		expect(decide("  short   ", base, undefined).kind).toBe("hide");
	});

	test("a slash command or bash-mode draft hides the band", () => {
		expect(decide("/compact keep the plan", base, undefined).kind).toBe("hide");
		expect(decide("!git status --short", base, undefined).kind).toBe("hide");
	});

	test("a draft equal to the last graded text reuses the cached grade", () => {
		expect(decide("fix the login bug", base, "fix the login bug").kind).toBe(
			"cached",
		);
	});

	test("a plain draft is graded as typed", () => {
		expect(decide("fix the login bug?", base, undefined)).toEqual({
			kind: "grade",
			draft: "fix the login bug?",
		});
	});

	test("a /goal objective is graded without the command", () => {
		expect(
			decide(
				"/goal fix the flaky login test and add a regression test",
				base,
				undefined,
			),
		).toEqual({
			kind: "grade",
			draft: "fix the flaky login test and add a regression test",
		});
	});

	test("a /goal separated by a newline is extracted too", () => {
		expect(decide("/goal\nfix the flaky login test", base, undefined)).toEqual({
			kind: "grade",
			draft: "fix the flaky login test",
		});
	});

	test("/loop drops its interval and grades the prompt", () => {
		expect(
			decide("/loop 5m check the deploy and report failures", base, undefined),
		).toEqual({ kind: "grade", draft: "check the deploy and report failures" });
	});

	test("/loop without an interval grades all of its argument", () => {
		expect(decide("/loop check deploy", base, undefined)).toEqual({
			kind: "grade",
			draft: "check deploy",
		});
	});

	test("/loop running a command, or an interval alone, hides", () => {
		expect(decide("/loop 5m /babysit-prs", base, undefined).kind).toBe("hide");
		expect(decide("/loop 5m", base, undefined).kind).toBe("hide");
	});

	test("an interval is only dropped after /loop", () => {
		expect(decide("/goal 5m is too slow, fix it", base, undefined).draft).toBe(
			"5m is too slow, fix it",
		);
	});

	test("a /goal under minChars after extraction hides", () => {
		expect(decide("/goal fix it", base, undefined).kind).toBe("hide");
	});

	test("end punctuation is judged on the extracted prompt", () => {
		const opt = { ...base, requireEndPunctuation: true };
		expect(decide("/goal fix the login bug and", opt, undefined).kind).toBe(
			"wait",
		);
		expect(decide("/goal fix the login bug.", opt, undefined).kind).toBe(
			"grade",
		);
	});

	test("the command name is case-insensitive and needs a space after it", () => {
		expect(decide("/GOAL fix the flaky login test", base, undefined).kind).toBe(
			"grade",
		);
		expect(
			decide("/goalx fix the flaky login test", base, undefined).kind,
		).toBe("hide");
	});

	test("the configured list decides which commands carry a prompt", () => {
		const opt = { ...base, promptCommands: ["goal", "schedule"] };
		expect(
			decide("/schedule nightly cleanup of tmp", opt, undefined).kind,
		).toBe("grade");
		expect(decide("/loop 5m check the deploy now", opt, undefined).kind).toBe(
			"hide",
		);
		const none = { ...base, promptCommands: [] };
		expect(decide("/goal fix the flaky login test", none, undefined).kind).toBe(
			"hide",
		);
	});

	test("only /loop hides an argument that starts with a slash", () => {
		expect(
			decide("/goal /tmp/x.ts is broken please fix", base, undefined),
		).toEqual({ kind: "grade", draft: "/tmp/x.ts is broken please fix" });
		expect(decide("/loop /babysit-prs", base, undefined).kind).toBe("hide");
		const opt = { ...base, promptCommands: ["foo"] };
		expect(decide("/foo /tmp/x.ts is broken", opt, undefined)).toEqual({
			kind: "grade",
			draft: "/tmp/x.ts is broken",
		});
	});

	test("a command with no argument hides", () => {
		const opt = { ...base, minChars: 0 };
		expect(decide("/goal", opt, undefined).kind).toBe("hide");
		expect(decide("/goal    ", opt, undefined).kind).toBe("hide");
	});

	test("a tab or CRLF after the command name still extracts", () => {
		expect(
			decide("/goal\tfix the flaky login test", base, undefined).draft,
		).toBe("fix the flaky login test");
		expect(
			decide("/goal\r\nfix the flaky login test", base, undefined).draft,
		).toBe("fix the flaky login test");
	});

	test("only a bare s, m, h or d interval is dropped: 5min stays in the draft", () => {
		expect(
			decide("/loop 5min check the deploy now", base, undefined).draft,
		).toBe("5min check the deploy now");
	});

	test("a cached grade is matched on the full text, command included", () => {
		const text = "/loop 5m check the deploy and report failures";
		expect(decide(text, base, text).kind).toBe("cached");
		expect(
			decide("/loop 10m check the deploy and report failures", base, text).kind,
		).toBe("grade");
	});

	test("a long enough new draft is graded, whatever its punctuation", () => {
		expect(decide("fix the login bug?", base, undefined).kind).toBe("grade");
		expect(decide("fix the login bug and", base, undefined).kind).toBe("grade");
	});

	test("with requireEndPunctuation, a draft ending mid-sentence waits", () => {
		const opt = { ...base, requireEndPunctuation: true };
		expect(decide("fix the login bug and", opt, undefined).kind).toBe("wait");
		expect(decide("see file.ts for the bug", opt, undefined).kind).toBe("wait");
	});

	test("with requireEndPunctuation, the draft's end decides, trailing space ignored", () => {
		const opt = { ...base, requireEndPunctuation: true };
		expect(decide("fix the login bug.  \n", opt, undefined).kind).toBe("grade");
		expect(decide("why does login fail?", opt, undefined).kind).toBe("grade");
		expect(decide("login fails again!", opt, undefined).kind).toBe("grade");
	});
});

describe("single flight", () => {
	test("a request made while one runs waits, and only the newest runs next", async () => {
		const started: string[] = [];
		const finishers: (() => void)[] = [];
		const run = (text: string) =>
			new Promise<void>((resolve) => {
				started.push(text);
				finishers.push(resolve);
			});
		const flight = createSingleFlight();
		void flight.request("a", run);
		void flight.request("b", run);
		void flight.request("c", run);
		expect(started).toEqual(["a"]);
		finishers[0]?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["a", "c"]);
	});

	test("drop forgets the waiting request", async () => {
		const started: string[] = [];
		const finishers: (() => void)[] = [];
		const run = (text: string) =>
			new Promise<void>((resolve) => {
				started.push(text);
				finishers.push(resolve);
			});
		const flight = createSingleFlight();
		void flight.request("a", run);
		void flight.request("b", run);
		flight.drop();
		finishers[0]?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(started).toEqual(["a"]);
	});

	test("waiting says whether a request is queued behind the running one", async () => {
		const run = () => new Promise<void>(() => {});
		const flight = createSingleFlight();
		void flight.request("a", run);
		expect(flight.waiting()).toBe(false);
		void flight.request("b", run);
		expect(flight.waiting()).toBe(true);
		flight.drop();
		expect(flight.waiting()).toBe(false);
	});

	test("a failing run still frees the slot", async () => {
		const started: string[] = [];
		const run = async (text: string) => {
			started.push(text);
			if (text === "a") throw new Error("boom");
		};
		const flight = createSingleFlight();
		await flight.request("a", run).catch(() => {});
		await flight.request("b", run);
		expect(started).toEqual(["a", "b"]);
	});
});
