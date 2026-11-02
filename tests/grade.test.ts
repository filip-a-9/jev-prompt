import { describe, expect, test } from "claude-code/testing";
import { gradeAnswers } from "../src/grade";
import { QUESTIONS, RUBRIC } from "../src/rubric";
import type { Answers, Dimension, Rubric, TaskType } from "../src/types";
import { DIMENSIONS, TASK_TYPES } from "../src/types";

type Scores = Record<Dimension, number>;

/** A full Jev answer set: the task-type choice plus one score per dimension. */
function answers(
	typeProbabilities: Record<string, number>,
	choice: string,
	scores: Scores,
	confidence: Partial<Record<Dimension, number>> = {},
): Answers {
	const score = (d: Dimension) => ({
		type: "score" as const,
		score: scores[d],
		confidence: confidence[d] ?? 0.8,
		probabilities: { [String(Math.round(scores[d]))]: 1 },
	});
	return {
		task_type: {
			type: "choice",
			choice,
			confidence: 0.9,
			probabilities: typeProbabilities,
		},
		goal: score("goal"),
		context: score("context"),
		verification: score("verification"),
		constraints: score("constraints"),
		evidence: score("evidence"),
		focus: score("focus"),
		rationale: score("rationale"),
		output: score("output"),
		reply_fit: score("reply_fit"),
	};
}

const allTop: Scores = {
	goal: 3,
	context: 3,
	verification: 2,
	constraints: 2,
	evidence: 2,
	focus: 2,
	rationale: 2,
	output: 2,
	reply_fit: 2,
};

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * The spec's starting weights (4.7), kept here so the formula tests do not
 * move when the shipped weights are recalibrated. Each row sums to 1.
 */
const START: Rubric = {
	questions: QUESTIONS,
	weights: {
		// goal context verif constr evid focus ration output reply
		bug_fix: w(0.2, 0.2, 0.15, 0.05, 0.25, 0.1, 0.05, 0, 0),
		feature: w(0.25, 0.2, 0.15, 0.15, 0, 0.1, 0.1, 0.05, 0),
		refactor: w(0.2, 0.2, 0.2, 0.2, 0, 0.1, 0.1, 0, 0),
		question: w(0.35, 0.25, 0, 0.05, 0, 0.15, 0.05, 0.15, 0),
		review: w(0.25, 0.25, 0.1, 0.15, 0, 0.1, 0.05, 0.1, 0),
		ops: w(0.3, 0.25, 0.15, 0.2, 0, 0.1, 0, 0, 0),
		follow_up: w(0.15, 0.1, 0, 0, 0, 0.1, 0, 0, 0.65),
		other: w(0.3, 0.25, 0.1, 0.1, 0, 0.15, 0.05, 0.05, 0),
	},
};

function w(...v: number[]): Record<Dimension, number> {
	return Object.fromEntries(DIMENSIONS.map((d, i) => [d, v[i] ?? 0])) as Record<
		Dimension,
		number
	>;
}

const gradeStart = (a: Answers) => gradeAnswers(a, START);

describe("gradeAnswers", () => {
	test("a certain bug fix is graded with the bug_fix weights", () => {
		// bug_fix row: goal .20 context .20 verification .15 constraints .05
		// evidence .25 focus .10 rationale .05 output 0 reply_fit 0
		// s: goal 3/3=1, context 2/3, verification 1/2, constraints 2/2=1,
		// evidence 0, focus 1, rationale 1/2, output 0, reply_fit 0
		// sum = .20 + .1333.. + .075 + .05 + 0 + .10 + .025 = .58333.. -> 58
		const g = gradeStart(
			answers({ bug_fix: 1 }, "bug_fix", {
				goal: 3,
				context: 2,
				verification: 1,
				constraints: 2,
				evidence: 0,
				focus: 2,
				rationale: 1,
				output: 0,
				reply_fit: 0,
			}),
		);
		expect(g.grade).toBe(58);
		expect(g.type).toBe("bug_fix");
		expect(g.gaps).toEqual(["evidence"]);
		expect(g.certain).toBe(true);
		expect(g.dimensions.context).toEqual({ s: 2 / 3, w: 0.2, confidence: 0.8 });
		expect(g.typeProbabilities).toEqual({
			bug_fix: 1,
			feature: 0,
			refactor: 0,
			question: 0,
			review: 0,
			ops: 0,
			follow_up: 0,
			other: 0,
		});
	});

	test("an even bug_fix/feature split blends the two weight rows", () => {
		// blended w: goal (.20+.25)/2=.225, context .20, verification .15,
		// constraints (.05+.15)/2=.10, evidence .125, focus .10,
		// rationale (.05+.10)/2=.075, output .025, reply_fit 0
		// s: all 1 except constraints 1/2, evidence 0, rationale 0
		// sum = .225 + .20 + .15 + .05 + 0 + .10 + 0 + .025 = .75 -> 75
		const g = gradeStart(
			answers({ bug_fix: 0.5, feature: 0.5 }, "feature", {
				goal: 3,
				context: 3,
				verification: 2,
				constraints: 1,
				evidence: 0,
				focus: 2,
				rationale: 0,
				output: 2,
				reply_fit: 0,
			}),
		);
		expect(g.grade).toBe(75);
		const w = {
			goal: 0.225,
			context: 0.2,
			verification: 0.15,
			constraints: 0.1,
			evidence: 0.125,
			focus: 0.1,
			rationale: 0.075,
			output: 0.025,
			reply_fit: 0,
		};
		for (const [d, want] of Object.entries(w)) {
			const got = g.dimensions[d as Dimension].w;
			expect([d, near(got, want)]).toEqual([d, true]);
		}
		// rationale (w .075) is under the gap weight floor; constraints sits at s .5
		expect(g.gaps).toEqual(["evidence"]);
	});

	test("a tie between task types goes to the first in TASK_TYPES order", () => {
		const g = gradeStart(
			answers({ feature: 0.5, bug_fix: 0.5 }, "feature", allTop),
		);
		expect(g.type).toBe("bug_fix");
	});

	test("type probabilities keep only known task types, renormalised", () => {
		const g = gradeStart(
			answers({ bug_fix: 0.3, ops: 0.1, banana: 0.6 }, "bug_fix", allTop),
		);
		expect(near(g.typeProbabilities.bug_fix, 0.75)).toBe(true);
		expect(near(g.typeProbabilities.ops, 0.25)).toBe(true);
		expect(g.typeProbabilities.other).toBe(0);
	});

	// With verification at 0 and everything else at the top:
	// ops row loses .15 -> 85, other row loses .10 -> 90.
	const noCheck: Scores = { ...allTop, verification: 0 };

	test("type probabilities that sum to 0 fall back to the choice", () => {
		const g = gradeStart(answers({ bug_fix: 0, ops: 0 }, "ops", noCheck));
		expect(g.type).toBe("ops");
		expect(g.typeProbabilities.ops).toBe(1);
		expect(g.grade).toBe(85);
	});

	test("an unknown choice with no probabilities counts as other", () => {
		const g = gradeStart(answers({}, "banana", noCheck));
		expect(g.type).toBe("other");
		expect(g.typeProbabilities.other).toBe(1);
		expect(g.grade).toBe(90);
	});
});

describe("gaps", () => {
	const bugFix = (scores: Partial<Scores>) =>
		gradeStart(answers({ bug_fix: 1 }, "bug_fix", { ...allTop, ...scores }));

	test("a weight of exactly 0.10 counts, a weight below it does not", () => {
		// focus w .10, s 0 -> gap; constraints w .05, s 0 -> not a gap
		expect(bugFix({ focus: 0, constraints: 0 }).gaps).toEqual(["focus"]);
	});

	test("a blended weight of 0.10 counts despite float rounding", () => {
		// focus is .10 in both rows, so .3·.10 + .7·.10 = .10 on paper
		const g = gradeStart(
			answers({ bug_fix: 0.3, feature: 0.7 }, "feature", {
				...allTop,
				focus: 0,
			}),
		);
		expect(g.gaps).toEqual(["focus"]);
	});

	test("a score of exactly half is not a gap", () => {
		// verification w .15: s 1/2 is not a gap, s 0 is
		expect(bugFix({ verification: 1 }).gaps).toEqual([]);
		expect(bugFix({ verification: 0 }).gaps).toEqual(["verification"]);
	});

	test("the two largest shortfalls w*(1-s) are kept, largest first", () => {
		// evidence .25*1=.25, context .20*1=.20, verification .15*1=.15,
		// goal .20*(1-1/3)=.133, focus .10*1=.10 -> top 2 keeps evidence, context
		const g = bugFix({
			goal: 1,
			context: 0,
			verification: 0,
			evidence: 0,
			focus: 0,
		});
		expect(g.gaps).toEqual(["evidence", "context"]);
	});

	test("equal shortfalls keep DIMENSIONS order", () => {
		// goal and context both .20*1
		expect(bugFix({ context: 0, goal: 0 }).gaps).toEqual(["goal", "context"]);
	});
});

describe("certainty", () => {
	// bug_fix weights: goal .20, evidence .25 at confidence 0; context .20,
	// verification .15, constraints .05, focus .10, rationale .05 (sum .55)
	// at confidence c; output and reply_fit (weight 0) at confidence 1.
	// Weighted mean = .55·c. An unweighted mean would be (5c + 2) / 9 ≈ .62.
	const withConfidence = (c: number) =>
		gradeStart(
			answers({ bug_fix: 1 }, "bug_fix", allTop, {
				goal: 0,
				evidence: 0,
				context: c,
				verification: c,
				constraints: c,
				focus: c,
				rationale: c,
				output: 1,
				reply_fit: 1,
			}),
		);

	test("a weighted mean confidence just under 0.4 is uncertain", () => {
		expect(withConfidence(0.72).certain).toBe(false); // .396
	});

	test("a weighted mean confidence just over 0.4 is certain", () => {
		expect(withConfidence(0.74).certain).toBe(true); // .407
	});
});

describe("normalised scores", () => {
	test("scores outside the level range are clamped to 0..1", () => {
		const g = gradeStart(
			answers({ bug_fix: 1 }, "bug_fix", {
				...allTop,
				verification: 2.4,
				evidence: -0.3,
			}),
		);
		expect(g.dimensions.verification.s).toBe(1);
		expect(g.dimensions.evidence.s).toBe(0);
		// bug_fix: everything at 1 except evidence (.25) at 0 -> 75
		expect(g.grade).toBe(75);
	});
});

describe("a custom rubric", () => {
	const questions = {
		...QUESTIONS,
		context: {
			type: "score" as const,
			instructions: "x",
			criteria: ["a", "b", "c", "d", "e"],
		},
	};
	const weights = Object.fromEntries(
		TASK_TYPES.map((t) => [
			t,
			Object.fromEntries(DIMENSIONS.map((d) => [d, d === "context" ? 1 : 0])),
		]),
	) as Record<TaskType, Record<Dimension, number>>;
	const rubric: Rubric = { questions, weights };
	const input = () =>
		answers({ bug_fix: 1 }, "bug_fix", { ...allTop, context: 2 });

	test("another level count and other weights change the grade", () => {
		// Context has 5 levels, so score 2 -> s = 2/4 = 0.5. All weight is on
		// context, so the grade is 100 * 1 * 0.5 = 50.
		const g = gradeAnswers(input(), rubric);
		expect(g.dimensions.context.s).toBe(0.5);
		expect(g.grade).toBe(50);
	});

	test("the same weights with the default 4-level question grade differently", () => {
		// 4 levels: s = 2/3, grade = round(66.67) = 67.
		expect(gradeAnswers(input(), { questions: QUESTIONS, weights }).grade).toBe(
			67,
		);
	});

	test("no rubric given: the default rubric, as before", () => {
		// shipped bug_fix row: context .30; all at the top except context 2/3:
		// 100 - 30 * (1/3) = 90
		expect(gradeAnswers(input()).grade).toBe(90);
		expect(gradeAnswers(input(), RUBRIC)).toEqual(gradeAnswers(input()));
	});
});
