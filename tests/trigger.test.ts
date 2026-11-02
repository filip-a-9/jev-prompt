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
	const base = { minChars: 10, requireEndPunctuation: false };

	test("a draft under minChars after trimming hides the band", () => {
		expect(decide("  short   ", base, undefined)).toBe("hide");
	});

	test("a slash command or bash-mode draft hides the band", () => {
		expect(decide("/compact keep the plan", base, undefined)).toBe("hide");
		expect(decide("!git status --short", base, undefined)).toBe("hide");
	});

	test("a draft equal to the last graded text reuses the cached grade", () => {
		expect(decide("fix the login bug", base, "fix the login bug")).toBe(
			"cached",
		);
	});

	test("a long enough new draft is graded, whatever its punctuation", () => {
		expect(decide("fix the login bug?", base, undefined)).toBe("grade");
		expect(decide("fix the login bug and", base, undefined)).toBe("grade");
	});

	test("with requireEndPunctuation, a draft ending mid-sentence waits", () => {
		const opt = { minChars: 10, requireEndPunctuation: true };
		expect(decide("fix the login bug and", opt, undefined)).toBe("wait");
		expect(decide("see file.ts for the bug", opt, undefined)).toBe("wait");
	});

	test("with requireEndPunctuation, the draft's end decides, trailing space ignored", () => {
		const opt = { minChars: 10, requireEndPunctuation: true };
		expect(decide("fix the login bug.  \n", opt, undefined)).toBe("grade");
		expect(decide("why does login fail?", opt, undefined)).toBe("grade");
		expect(decide("login fails again!", opt, undefined)).toBe("grade");
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
