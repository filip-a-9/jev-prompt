import type { On, PromptChangeInput, PromptEditInput } from "claude-code";
import { describe, type Engine, expect, mock, test } from "claude-code/testing";
import { bugfixZdr } from "./fixtures/bugfix-zdr";

// The world beneath the plugin: a prompt box, a mocked clock and store, an
// empty conversation, no CLAUDE.md, and a Jev endpoint the test scripts.

type Reply = { status: number; text: string };
type Fetch = { url: string; body: string };

const KEY = { options: { openrouterApiKey: "test-key" } };

function world(
	on: On,
	reply: (call: Fetch) => Reply | Promise<Reply>,
	messages: () => unknown[] = () => [],
) {
	const clock = mock.clock(on);
	mock.store(on);
	const calls: Fetch[] = [];
	const logs: string[] = [];
	const box = { text: "" };
	on("prompt.read", () => ({
		value: { text: box.text, cursor: box.text.length },
	}));
	on("prompt.edit", (_, e) => {
		const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end);
		box.text = text;
		return { text, cursor: e.start + e.inputText.length };
	});
	on("prompt.change", (_, e) => {
		box.text = e.text;
		return { text: e.text };
	});
	on("prompt.submit", (_, e) => {
		box.text = "";
		return { text: e.text };
	});
	on("session.messages", () => ({ value: messages() as never }));
	on("fs.read", () => {
		throw new Error("ENOENT");
	});
	on("command.register", (_, e) => ({ value: { command: e.name } }));
	on("ui.log", (_, e) => {
		logs.push(e.text);
		return { value: undefined };
	});
	on("http.fetch", async (_, e) => {
		const call = { url: e.url, body: String(e.init?.body ?? "") };
		calls.push(call);
		const r = await reply(call);
		return {
			value: {
				status: r.status,
				ok: r.status >= 200 && r.status < 300,
				headers: {},
				text: r.text,
			},
		};
	});
	return { clock, calls, logs, box };
}

/**
 * The kit raises \`prompt.edit\` and \`prompt.change\` at run time, but its
 * \`Engine\` type leaves them out of the prompt noun's call table.
 */
type Raise = {
	edit: (e: PromptEditInput) => Promise<unknown>;
	change: (e: PromptChangeInput) => Promise<unknown>;
};
const raise = ($: Engine) => $.prompt as unknown as Raise;

/** Types \`s\` at the end of the box, as one composer edit. */
async function type($: Engine, w: { box: { text: string } }, s: string) {
	const text = w.box.text;
	await raise($).edit({
		origin: { kind: "composer" },
		text,
		cursor: text.length,
		start: text.length,
		end: text.length,
		inputText: s,
	});
}

/** Deletes the last \`n\` characters of the box, as one composer edit. */
async function erase($: Engine, w: { box: { text: string } }, n: number) {
	const text = w.box.text;
	await raise($).edit({
		origin: { kind: "composer" },
		text,
		cursor: text.length,
		start: text.length - n,
		end: text.length,
		inputText: "",
	});
}

const ABOVE = {
	hasSurvey: false,
	isWorking: false,
	maxRows: 10,
	bodyColumns: 100,
	scroll: { offset: 0, bodyRows: 10 },
	view: {},
};

/** What the band draws now: its Text's text and colour. */
async function drawn($: Engine, props: Partial<typeof ABOVE> = {}) {
	const ui = await $.ui.mount({
		plugin: "jev-prompt",
		surface: "terminal",
		component: "AbovePrompt",
		props: { ...ABOVE, ...props },
	});
	const t = await ui.find({ type: "Text" });
	return t && { text: t.text, color: t.props.color };
}

/** The band, or undefined when no plugin draws anything there. */
async function band($: Engine, props: Partial<typeof ABOVE> = {}) {
	try {
		return await drawn($, props);
	} catch (err) {
		if (String(err).includes("no implementation for ui.render")) return;
		throw err;
	}
}

/** Runs \`/jev <args>\` as typed at the prompt. */
const jev = ($: Engine, args = "") =>
	$.command.run({
		command: "jev",
		args,
		origin: { kind: "composer" },
		presentation: { isFullscreen: false, columns: 100 },
	});

const reply = (status: number): Reply => ({
	status,
	text: JSON.stringify({ error: { code: status, message: "x" } }),
});
const unauthorized = reply(401);
/** Jev's real answer to a bug-fix draft (tests/fixtures). */
const graded: Reply = {
	status: bugfixZdr.status,
	text: JSON.stringify(bugfixZdr.body),
};
/** Band colour the spec (4.8) gives a grade: green, yellow or red. */
const colourOf = (grade: number) =>
	grade >= 80 ? "success" : grade >= 50 ? "warning" : "error";
const percent = (text = "") => Number(/jev ~?(\d+)%/.exec(text)?.[1]);

/** A reply the test releases by hand, to hold a request in flight. */
function held() {
	let release: (r: Reply) => void = () => {};
	const promise = new Promise<Reply>((r) => {
		release = r;
	});
	return { promise, release: (r: Reply) => release(r) };
}

describe("trigger", () => {
	test(
		"edits within the idle time make no call; ten idle seconds make one",
		KEY,
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await type($, w, "fix the login");
			await w.clock.advance(6000);
			await type($, w, " bug please");
			await w.clock.advance(9999);
			expect(w.calls.length).toBe(0);
			await w.clock.advance(1);
			expect(w.calls.length).toBe(1);
		},
	);

	test(
		"a draft ending in ? still waits the full idle time",
		KEY,
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await type($, w, "why does the login fail?");
			await w.clock.advance(9999);
			expect(w.calls.length).toBe(0);
			await w.clock.advance(1);
			expect(w.calls.length).toBe(1);
		},
	);

	test(
		"with requireEndPunctuation, a mid-sentence draft makes no call and one ending in . does",
		{ options: { openrouterApiKey: "test-key", requireEndPunctuation: true } },
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await type($, w, "fix the login bug and");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(0);
			await type($, w, " add a test.");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
		},
	);

	test("pasted or recalled text starts the wait too", KEY, async ($, on) => {
		const w = world(on, () => unauthorized);
		await raise($).change({
			text: "fix the login bug please",
			cursor: 24,
			origin: { kind: "history" },
		});
		await w.clock.advance(10000);
		expect(w.calls.length).toBe(1);
	});

	test("a short draft or a slash command makes no call", KEY, async ($, on) => {
		const w = world(on, () => unauthorized);
		await type($, w, "fix it");
		await w.clock.advance(10000);
		await type($, w, "/compact keep the plan");
		w.box.text = "/compact keep the plan";
		await w.clock.advance(10000);
		expect(w.calls.length).toBe(0);
	});

	test(
		"a result for text no longer in the box is dropped, and the newest draft is graded next",
		{ options: { openrouterApiKey: "test-key", timeoutMs: 60000 } },
		async ($, on) => {
			const first = held();
			const second = held();
			const w = world(on, () =>
				w.calls.length === 1 ? first.promise : second.promise,
			);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			await type($, w, " in src/auth.ts");
			await w.clock.advance(10000);
			first.release(reply(500));
			await w.clock.advance(0);
			expect((await band($))?.text ?? "").not.toContain("unexpected");
			expect(w.calls.length).toBe(2);
			expect(JSON.parse(w.calls[1]?.body ?? "{}").state.draft).toBe(
				"fix the login bug in src/auth.ts",
			);
			second.release(unauthorized);
			await w.clock.advance(0);
			expect((await band($))?.text).toContain("key rejected");
		},
	);
	test(
		"a draft queued behind a call that comes back 401 is never sent, and the band says why",
		{ options: { openrouterApiKey: "test-key", timeoutMs: 60000 } },
		async ($, on) => {
			const first = held();
			const w = world(on, () => first.promise);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			await type($, w, " in src/auth.ts");
			await w.clock.advance(10000);
			first.release(unauthorized);
			await w.clock.advance(0);
			expect(w.calls.length).toBe(1);
			expect((await band($))?.text).toContain("key rejected");
		},
	);

	test(
		"a draft queued behind a call that comes back 429 waits out the pause, and the band says why",
		{ options: { openrouterApiKey: "test-key", timeoutMs: 60000 } },
		async ($, on) => {
			const first = held();
			const w = world(on, () => first.promise);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			await type($, w, " in src/auth.ts");
			await w.clock.advance(10000);
			first.release(reply(429));
			await w.clock.advance(0);
			expect(w.calls.length).toBe(1);
			expect((await band($))?.text).toContain("rate limited");
		},
	);

	test(
		"a queued draft edited since it was queued is not sent; the newest one is",
		{ options: { openrouterApiKey: "test-key", timeoutMs: 60000 } },
		async ($, on) => {
			const first = held();
			const w = world(on, () =>
				w.calls.length === 1 ? first.promise : unauthorized,
			);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			await type($, w, " in src/auth.ts");
			await w.clock.advance(10000);
			await type($, w, " today");
			await w.clock.advance(1000);
			first.release(reply(500));
			await w.clock.advance(0);
			expect(w.calls.length).toBe(1);
			await w.clock.advance(9000);
			expect(w.calls.length).toBe(2);
			expect(JSON.parse(w.calls[1]?.body ?? "{}").state.draft).toBe(
				"fix the login bug in src/auth.ts today",
			);
		},
	);
});

describe("band", () => {
	test(
		"a grade shows its percent, task type and the colour for that percent",
		KEY,
		async ($, on) => {
			const w = world(on, () => graded);
			await type($, w, "fix the login bug in src/auth.ts");
			await w.clock.advance(10000);
			const shown = await band($);
			expect(shown?.text).toContain("bug fix");
			const p = percent(shown?.text);
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThanOrEqual(100);
			expect(shown?.color).toBe(colourOf(p));
		},
	);

	test("typing turns a shown grade gray", KEY, async ($, on) => {
		const w = world(on, () => graded);
		await type($, w, "fix the login bug in src/auth.ts");
		await w.clock.advance(10000);
		const before = await band($);
		await type($, w, " now");
		const after = await band($);
		expect(after?.text).toBe(before?.text);
		expect(after?.color).toBe("ansi256(245)");
	});

	test(
		"returning to a graded draft shows its grade again without a second call",
		KEY,
		async ($, on) => {
			const w = world(on, () => graded);
			await type($, w, "fix the login bug in src/auth.ts");
			await w.clock.advance(10000);
			const first = await band($);
			await type($, w, " now");
			await w.clock.advance(3000);
			await erase($, w, 4);
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
			expect(await band($)).toEqual(first);
		},
	);

	test(
		"a result dropped because the draft changed does not leave the band on grading",
		{ options: { openrouterApiKey: "test-key", timeoutMs: 60000 } },
		async ($, on) => {
			const first = held();
			const w = world(on, () => first.promise);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			expect((await band($))?.text).toContain("grading");
			await type($, w, " now");
			first.release(reply(500));
			await w.clock.advance(0);
			expect((await band($))?.text ?? "").not.toContain("grading");
		},
	);

	test(
		"a failure while building the request does not leave the band on grading",
		KEY,
		async ($, on) => {
			const w = world(
				on,
				() => graded,
				() => {
					throw new Error("conversation unavailable");
				},
			);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			expect((await band($))?.text ?? "").not.toContain("grading");
		},
	);
	test(
		"a rejected key shows in red and stops further calls",
		KEY,
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			const shown = await band($);
			expect(shown?.text).toContain("key rejected");
			expect(shown?.color).toBe("error");
			await type($, w, " now");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
		},
	);

	test("submitting clears the band", KEY, async ($, on) => {
		const w = world(on, () => unauthorized);
		await type($, w, "fix the login bug");
		await w.clock.advance(10000);
		expect(await band($)).toBeDefined();
		await $.prompt.submit({
			text: w.box.text,
			wait: false,
			origin: { kind: "composer" },
		});
		expect(await band($)).toBeUndefined();
	});

	test(
		"while a survey holds the band, it shows nothing of ours",
		KEY,
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			expect(await band($, { hasSurvey: true })).toBeUndefined();
		},
	);

	test("without a key: one notice to set it, and no call", async ($, on) => {
		const w = world(on, () => unauthorized);
		await type($, w, "fix the login bug");
		await w.clock.advance(10000);
		expect((await band($))?.text).toContain("/config");
		expect(w.calls.length).toBe(0);
	});

	test(
		"rate limited: no call for 30 s, then grading resumes",
		KEY,
		async ($, on) => {
			const w = world(on, () => reply(429));
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			expect((await band($))?.text).toContain("rate limited");
			await type($, w, " now");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
			await type($, w, " please");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
			await type($, w, ".");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(2);
		},
	);
});

describe("/jev", () => {
	test(
		"off stops grading and hides the band; on resumes",
		KEY,
		async ($, on) => {
			const w = world(on, () => unauthorized);
			await jev($, "off");
			await type($, w, "fix the login bug");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(0);
			expect(await band($)).toBeUndefined();
			await jev($, "on");
			await type($, w, " now");
			await w.clock.advance(10000);
			expect(w.calls.length).toBe(1);
		},
	);

	test(
		"status says whether grading is on and names the model",
		KEY,
		async ($, on) => {
			world(on, () => unauthorized);
			const on1 = await jev($);
			expect(on1.text).toContain("typesafe/jev-1.14");
			await jev($, "off");
			const off = await jev($);
			expect(off.text).not.toBe(on1.text);
		},
	);
});
