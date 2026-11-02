// The rubric sent to Jev (spec 4.5): one choice question for the task type
// and one score question per dimension, plus the weights and labels the
// grader and the band use (spec 4.7, 4.8).
//
// Each level is judged on its own, without its number or its neighbours, so
// every level describes a situation that stands alone. Where the spec says
// "where it matters", "doesn't matter for this request" sits on the top level
// so a short good prompt is not marked down for leaving it out.

import type {
	Dimension,
	JevQuestion,
	Questions,
	Rubric,
	TaskType,
	Weights,
} from "./types";

const JUDGING =
	"Judging draft, taking into account what last_assistant_reply, previous_user_prompt and project_instructions already establish.";

function score(measure: string, levels: readonly string[]): JevQuestion {
	return {
		type: "score",
		instructions: `${measure} ${JUDGING}`,
		criteria: levels,
	};
}

export const QUESTIONS: Questions = {
	task_type: {
		type: "choice",
		instructions:
			"What kind of request is draft? A reply to last_assistant_reply is follow_up.",
		criteria: {
			bug_fix: "Fix something that errors or misbehaves.",
			feature: "Add new behaviour.",
			refactor: "Restructure code without changing behaviour.",
			question: "Asks for an explanation, not a change.",
			review: "Review code, a diff or a plan.",
			ops: "Shell, git, build, deploy or environment work.",
			follow_up: "Answers or steers Claude's last reply, e.g. 'yes, do that'.",
			other: "None of these.",
		},
	},
	goal: score("Is the wanted outcome unambiguous?", [
		"Claude cannot tell what is wanted: no request is made and none follows from the last reply.",
		"A request is only implied; Claude must guess what result is wanted.",
		"A result is asked for but can be read two ways.",
		"One outcome is asked for, open to only one reading; asking Claude to interview, plan or propose first counts.",
	]),
	context: score(
		"Does Claude have what it needs to start: where, what and which item?",
		[
			"Claude would have to ask what is meant, or search blindly for it.",
			"Only a broad area is given; Claude must guess which item, file or repo.",
			"Most of what is needed is given; one detail must be guessed or looked up.",
			"Everything needed is named, already known from the last reply or project instructions, or the request needs none, e.g. a question or a request to interview or propose first.",
		],
	),
	verification: score("Is it said how success is judged?", [
		"The result needs checking and nothing says how.",
		"A check is implied, e.g. 'make it work again'.",
		"A check is stated (a test, expected output, an acceptance condition), or the result needs none, e.g. a question or a status check.",
	]),
	constraints: score("Are scope limits stated where they matter?", [
		"Scope matters and nothing limits what may change.",
		"Some limits are given; where to stop is open.",
		"Limits and non-goals are clear, or the request needs none.",
	]),
	evidence: score("For a problem: is observed vs expected given?", [
		"No observed behaviour is described.",
		"The problem is named vaguely, e.g. 'it's broken'.",
		"Error text, a repro or observed vs expected is given.",
	]),
	focus: score("Is it one coherent request?", [
		"Several unrelated requests at once.",
		"Related requests sprawling over many changes.",
		"One coherent piece of work.",
	]),
	rationale: score("Is the reason given where it matters?", [
		"The reason would change the answer and none is given.",
		"The reason is only hinted at.",
		"The reason is given, or the answer does not depend on it.",
	]),
	output: score("Is the form of the answer or deliverable clear?", [
		"The form matters and nothing says what it is.",
		"Some of the form is given, e.g. code vs plan; the rest is open.",
		"The form is clear (length, format, file, code or plan) or any will do.",
	]),
	reply_fit: score("Does it clearly answer or steer last_assistant_reply?", [
		"It ignores what the last reply asked, or it is unclear what in it it refers to.",
		"It probably refers to one part of the last reply; another reading fits.",
		"It plainly answers or steers one part of the last reply.",
	]),
};

/** Number of levels of a dimension's score question. */
export function levelCount(
	d: Dimension,
	questions: Questions = QUESTIONS,
): number {
	const q = questions[d];
	return q.type === "score" ? q.criteria.length : 0;
}

type Row = Readonly<Record<Dimension, number>>;

function row(
	goal: number,
	context: number,
	verification: number,
	constraints: number,
	evidence: number,
	focus: number,
	rationale: number,
	output: number,
	reply_fit: number,
): Row {
	return {
		goal,
		context,
		verification,
		constraints,
		evidence,
		focus,
		rationale,
		output,
		reply_fit,
	};
}

/** The Jev release the weights below were fitted on (spec 4.10, 6). */
export const CALIBRATED_MODEL = "typesafe/jev-1.14-20261014";

/**
 * The /jev lines for the model: the one Jev answered with, or before any
 * answer (undefined) the configured one, marked as not answered yet.
 */
export function modelLines(
	answered: string | undefined,
	configured: string,
): string[] {
	const model = answered ?? configured;
	const note = answered === undefined ? "no answer yet, " : "";
	const lines = [`model: ${model} (${note}calibrated: ${CALIBRATED_MODEL})`];
	if (model !== CALIBRATED_MODEL) {
		lines.push("model differs from calibration: grades are uncalibrated");
	}
	return lines;
}

/**
 * Calibrated weights (spec 6), for typesafe/jev-1.14-20261014: one row R for
 * every type, fitted on 84 labelled prompts. bug_fix mixes in evidence at .25
 * (no bug fix was in the labelled set); follow_up mixes in reply_fit at .10.
 * Each row sums to 1.
 */
export const WEIGHTS: Weights = {
	//                     goal    context verif constr evid focus   ration output reply
	bug_fix: row(0.2625, 0.3, 0, 0, 0.25, 0.1875, 0, 0, 0),
	feature: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
	refactor: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
	question: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
	review: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
	ops: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
	follow_up: row(0.315, 0.36, 0, 0, 0, 0.225, 0, 0, 0.1),
	other: row(0.35, 0.4, 0, 0, 0, 0.25, 0, 0, 0),
};

/** The rubric the mod grades with. */
export const RUBRIC: Rubric = { questions: QUESTIONS, weights: WEIGHTS };

/** Short names of the gaps shown in the band (spec 4.8). */
export const GAP_LABELS: Readonly<Record<Dimension, string>> = {
	goal: "clear goal",
	context: "which file/error",
	verification: "how to verify",
	constraints: "scope limits",
	evidence: "error output",
	focus: "one request",
	rationale: "why",
	output: "answer format",
	reply_fit: "what it refers to",
};

/** Task-type names shown in the band (spec 4.8). */
export const TYPE_LABELS: Readonly<Record<TaskType, string>> = {
	bug_fix: "bug fix",
	feature: "feature",
	refactor: "refactor",
	question: "question",
	review: "review",
	ops: "ops",
	follow_up: "follow-up",
	other: "other",
};
