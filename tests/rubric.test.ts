import { describe, expect, test } from "claude-code/testing";
import { levelCount, QUESTIONS, WEIGHTS } from "../src/rubric";

describe("levelCount", () => {
	test("goal and context have 4 levels, every other dimension 3", () => {
		const want = {
			goal: 4,
			context: 4,
			verification: 3,
			constraints: 3,
			evidence: 3,
			focus: 3,
			rationale: 3,
			output: 3,
			reply_fit: 3,
		} as const;
		for (const [d, n] of Object.entries(want)) {
			expect([d, levelCount(d as keyof typeof want)]).toEqual([d, n]);
		}
	});
});

describe("QUESTIONS", () => {
	test("asks task_type plus one question per dimension, nothing else", () => {
		expect(Object.keys(QUESTIONS).sort()).toEqual(
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
	});

	test("task_type is a choice whose options are exactly the eight task types", () => {
		const q = QUESTIONS.task_type;
		expect(q.type).toBe("choice");
		if (q.type !== "choice") return;
		expect(Object.keys(q.criteria).sort()).toEqual(
			[
				"bug_fix",
				"feature",
				"refactor",
				"question",
				"review",
				"ops",
				"follow_up",
				"other",
			].sort(),
		);
		for (const guidance of Object.values(q.criteria)) {
			expect(guidance.trim().length).toBeGreaterThan(0);
		}
	});

	test("every score question judges draft against all three context fields", () => {
		for (const [key, q] of Object.entries(QUESTIONS)) {
			if (key === "task_type") continue;
			expect([key, q.type]).toEqual([key, "score"]);
			for (const field of [
				"draft",
				"last_assistant_reply",
				"previous_user_prompt",
				"project_instructions",
			]) {
				expect([key, q.instructions.includes(field)]).toEqual([key, true]);
			}
		}
	});

	test("every score level is a distinct, non-empty situation of one shape", () => {
		for (const [key, q] of Object.entries(QUESTIONS)) {
			if (q.type !== "score") continue;
			const texts = q.criteria.map((l) => (typeof l === "string" ? l : l.what));
			for (const t of texts)
				expect([key, t.trim().length > 0]).toEqual([key, true]);
			expect([key, new Set(texts).size]).toEqual([key, texts.length]);
			const shapes = new Set(q.criteria.map((l) => typeof l));
			expect([key, shapes.size]).toEqual([key, 1]);
		}
	});

	test("serialized questions stay within the 4096-byte cost budget", () => {
		const bytes = new TextEncoder().encode(JSON.stringify(QUESTIONS)).length;
		expect(bytes).toBeLessThanOrEqual(4096);
	});
});

describe("WEIGHTS", () => {
	const types = [
		"bug_fix",
		"feature",
		"refactor",
		"question",
		"review",
		"ops",
		"follow_up",
		"other",
	] as const;

	test("has a row for every task type, each summing to 1", () => {
		expect(Object.keys(WEIGHTS).sort()).toEqual([...types].sort());
		for (const t of types) {
			const sum = Object.values(WEIGHTS[t]).reduce((a, b) => a + b, 0);
			expect([t, Math.abs(sum - 1) < 1e-9]).toEqual([t, true]);
		}
	});

	test("evidence counts only for bug fixes", () => {
		expect(WEIGHTS.bug_fix.evidence).toBe(0.25);
		for (const t of types) {
			if (t !== "bug_fix") expect([t, WEIGHTS[t].evidence]).toEqual([t, 0]);
		}
	});

	test("reply_fit counts only for follow-ups", () => {
		expect(WEIGHTS.follow_up.reply_fit).toBe(0.65);
		for (const t of types) {
			if (t !== "follow_up") expect([t, WEIGHTS[t].reply_fit]).toEqual([t, 0]);
		}
	});
});
