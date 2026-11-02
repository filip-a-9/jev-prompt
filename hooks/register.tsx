// Wiring only (spec 5): events → trigger, band, command.
//
// The engine lets `$` reach only top-level functions of this module and of
// its own files, and never be stored, so the helpers below take it as their
// first argument and the module's state lives at the top level. A reload runs
// `register` again, which starts that state over.
import {
	atom,
	type EngineInterface,
	type Register,
	read,
	update,
} from "claude-code";
import { bandDecision, bandLine, quietReason } from "../src/band";
import { DEFAULTS, parseConfig } from "../src/config";
import { buildState, INSTRUCTION_PATHS } from "../src/context";
import { gradeAnswers } from "../src/grade";
import { type Io, jevCall, loadSpend, newLedger } from "../src/jev";
import { redactState } from "../src/redact";
import { GAP_LABELS, TYPE_LABELS } from "../src/rubric";
import { createDebounce, createSingleFlight, decide } from "../src/trigger";
import type { Config, Grade } from "../src/types";
import type { BandView } from "../types";

const HIDDEN: BandView = { kind: "hidden" };
const band = atom({ plugin: "jev-prompt", key: "band" } as const, HIDDEN);
const paused = atom({ plugin: "jev-prompt", key: "paused" } as const, false);

const RATE_LIMIT_PAUSE_MS = 30_000;
const INSTRUCTIONS_TTL_MS = 60_000;

const fresh = () => ({
	config: DEFAULTS as Config,
	/** What the band shows, mirrored so the typing path never reads state. */
	shown: HIDDEN as BandView,
	lastGraded: undefined as { text: string; grade: Grade } | undefined,
	keyNoticeShown: false,
	/** Why calls stopped (401/403, ZDR refusal); a config change reloads. */
	stopped: undefined as BandView | undefined,
	pausedUntil: 0,
	instructions: undefined as { at: number; files: string[] } | undefined,
	debounce: createDebounce(),
	flight: createSingleFlight(),
	/** Spend the store failed to take, kept so the cap still sees it. */
	ledger: newLedger(),
});
let S = fresh();

const notice = (text: string, tone: "gray" | "red"): BandView => ({
	kind: "notice",
	text,
	tone,
});

const gradeView = (g: Grade): BandView => {
	const mode = bandDecision(g);
	if (mode === "quiet") return HIDDEN;
	return {
		kind: "grade",
		mode,
		typeLabel: TYPE_LABELS[g.type],
		gaps: g.gaps.map((d) => GAP_LABELS[d]),
		stale: false,
	};
};

const usd = (n: number) => `$${n.toFixed(4)}`;

function show($: EngineInterface, view: BandView): void {
	S.shown = view;
	void update($, band, () => view).catch(() => {});
}

/** Why no call may be made now, as the band says it; undefined if one may. */
async function blocked($: EngineInterface): Promise<BandView | undefined> {
	if (S.stopped) return S.stopped;
	if ((await $.clock.now()) < S.pausedUntil) {
		return notice("jev: rate limited", "gray");
	}
	return undefined;
}

/** A run ended showing nothing: don't leave "grading…" up unless one waits. */
function settle($: EngineInterface): void {
	if (S.shown.kind === "grading" && !S.flight.waiting()) show($, HIDDEN);
}

/** What src/jev.ts reaches the world through. */
function ioOf($: EngineInterface): Io {
	return {
		fetch: (url, init) => $.http.fetch(url, init),
		now: () => $.clock.now(),
		after: (ms, fn) => $.clock.after(ms, fn),
		storeGet: (key) => $.store.get(key),
		storeSet: (key, value) => $.store.set(key, value),
		log: (text) => $.ui.log(text, { to: "debug" }),
	};
}

async function instructionFiles($: EngineInterface): Promise<string[]> {
	const now = await $.clock.now();
	const cached = S.instructions;
	if (cached && now - cached.at < INSTRUCTIONS_TTL_MS) return cached.files;
	const files = await Promise.all(
		INSTRUCTION_PATHS.map((p) => $.fs.read(p).catch(() => "")),
	);
	S.instructions = { at: now, files };
	return files;
}

/**
 * One grade of the box `text`, run through the single flight. `draft` is what
 * Jev sees: the same text, or the prompt inside a command like /goal.
 */
async function grade(
	$: EngineInterface,
	text: string,
	draft: string,
): Promise<void> {
	// It may have waited behind a call that stopped or paused grading, or
	// the draft may have changed since it was queued.
	const why = await blocked($);
	if (why) return show($, why);
	if ((await $.prompt.read()).text !== text || (await read($, paused))) return;
	const messages = (await $.session.messages()).map((m) => ({
		role: m.role,
		text: m.text,
	}));
	const state = redactState(
		buildState({
			draft,
			messages,
			instructionFiles: await instructionFiles($),
		}),
	);
	const out = await jevCall(ioOf($), S.config, state, S.ledger);
	if (out.kind === "ok") {
		S.lastGraded = { text, grade: gradeAnswers(out.answers) };
	}
	if (out.kind === "key-rejected") {
		S.stopped = notice("jev: key rejected", "red");
	}
	if (out.kind === "zdr-unavailable") {
		S.stopped = notice("jev: no zero-retention provider", "red");
	}
	if (out.kind === "rate-limited") {
		S.pausedUntil = (await $.clock.now()) + RATE_LIMIT_PAUSE_MS;
	}
	// Typing, a submit or /jev off since the call: the result is stale.
	if ((await $.prompt.read()).text !== text || (await read($, paused))) {
		return;
	}
	switch (out.kind) {
		case "ok":
			return S.lastGraded && show($, gradeView(S.lastGraded.grade));
		case "budget":
			return show($, notice("jev: budget reached", "gray"));
		case "offline":
			return show($, notice("jev: offline", "gray"));
		case "rate-limited":
		case "key-rejected":
		case "zdr-unavailable":
			return show($, (await blocked($)) ?? HIDDEN);
		case "unexpected":
			return show($, notice("jev: unexpected response", "red"));
	}
}

/** The idle wait ended: decide, then grade through the single flight. */
async function onIdle($: EngineInterface): Promise<void> {
	if (await read($, paused)) return;
	const { text } = await $.prompt.read();
	const decision = decide(text, S.config, S.lastGraded?.text);
	switch (decision.kind) {
		case "hide":
			return show($, HIDDEN);
		case "wait":
			return;
		case "cached":
			return S.lastGraded && show($, gradeView(S.lastGraded.grade));
	}
	if (!S.config.apiKey) {
		if (!S.keyNoticeShown) {
			S.keyNoticeShown = true;
			show($, notice("jev: no API key, see /jev", "gray"));
		}
		return;
	}
	const why = await blocked($);
	if (why) return show($, why);
	show($, { kind: "grading" });
	void S.flight.request(text, (t: string) =>
		grade($, t, decision.draft)
			.catch(() => {})
			.finally(() => settle($)),
	);
}

/** The typing path: restart the idle wait, mark a grade stale. No I/O. */
function edited($: EngineInterface, text: string): void {
	S.debounce.edited(text, () =>
		$.clock.after(S.config.idleMs, () => void onIdle($).catch(() => {})),
	);
	if (S.shown.kind === "grade" && !S.shown.stale) {
		show($, { ...S.shown, stale: true });
	}
}

async function status($: EngineInterface): Promise<string> {
	const c = S.config;
	const spend = await loadSpend(ioOf($)).catch(() => undefined);
	const lines = [
		`jev: ${(await read($, paused)) ? "off" : "on"}  ·  model ${c.model}`,
		`prompt commands graded: ${c.promptCommands.length ? c.promptCommands.map((n) => `/${n}`).join(", ") : "none"}`,
		spend
			? `spend today ${usd(spend.dayUsd)} of ${usd(c.dailyBudgetUsd)}, ` +
				`this month ${usd(spend.monthUsd)} of ${usd(c.monthlyBudgetUsd)}`
			: "spend unreadable: the store failed, so grading is stopped",
	];
	if (!c.apiKey) {
		lines.push(
			"no key set: /plugin install jev-prompt@jev-prompt asks for it " +
				"(secret options are not shown in /config)",
		);
	}
	const g = S.lastGraded?.grade;
	if (g) {
		lines.push(
			`last grade: rough ${g.grade}%, ${g.certain ? "certain" : "uncertain"}`,
		);
		const why = quietReason(g);
		if (why) lines.push(`quiet: ${why}`);
		lines.push("dimension      score  weight  confidence");
		for (const [d, r] of Object.entries(g.dimensions)) {
			lines.push(
				`${d.padEnd(14)} ${r.s.toFixed(2)}   ${r.w.toFixed(2)}    ${r.confidence.toFixed(2)}`,
			);
		}
		const types = Object.entries(g.typeProbabilities)
			.filter(([, p]) => p > 0)
			.sort(([, a], [, b]) => b - a)
			.map(([t, p]) => `${t} ${p.toFixed(2)}`);
		lines.push(`task type: ${types.join(", ")}`);
	}
	return lines.join("\n");
}

export const register: Register = (on, options) => {
	S = fresh();
	S.config = parseConfig(options);

	on("prompt.edit", async ($, e, next) => {
		const r = await next(e);
		edited($, r.text);
		return r;
	});

	on("prompt.change", ($, e, next) => {
		edited($, e.text);
		return next(e);
	});

	on("prompt.submit", ($, e, next) => {
		S.debounce.cancel();
		S.flight.drop();
		show($, HIDDEN);
		return next(e);
	});

	on("session.start", async ($, e, next) => {
		// The band atom survives a reload, this module's state does not: whatever
		// the earlier run left there would never be updated again.
		show($, HIDDEN);
		await $.command.register({
			name: "jev",
			description: "jev-prompt: grading status, or turn it on/off",
			argumentHint: "[on|off]",
		});
		return next(e);
	});

	on("command.run", { command: "jev" }, async ($, e) => {
		const arg = e.args.trim();
		if (arg === "off") {
			await update($, paused, () => true);
			S.debounce.cancel();
			S.flight.drop();
			show($, HIDDEN);
			return { text: "jev: grading off for this session" };
		}
		if (arg === "on") {
			await update($, paused, () => false);
			// A draft already in the box would wait for an edit that may never
			// come: start its idle wait now (onIdle reads the box when it fires).
			S.debounce.cancel();
			edited($, (await $.prompt.read()).text);
			return { text: "jev: grading on" };
		}
		return { text: await status($) };
	});

	on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
		if (e.props.hasSurvey) return next(e);
		const line = bandLine(await read($, band));
		if (!line) return next(e);
		const { Text } = $.ui.resolve(e);
		return (
			<Text color={line.color} wrap="truncate">
				{line.text}
			</Text>
		);
	});
};
