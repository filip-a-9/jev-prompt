// Shared shapes. Types only: every module that has logic owns its own file.

export const TASK_TYPES = [
	"bug_fix",
	"feature",
	"refactor",
	"question",
	"review",
	"ops",
	"follow_up",
	"other",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const DIMENSIONS = [
	"goal",
	"context",
	"verification",
	"constraints",
	"evidence",
	"focus",
	"rationale",
	"output",
	"reply_fit",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** The typed configuration (spec 4.10). Only src/config.ts builds one. */
export type Config = {
	apiKey: string | undefined;
	model: string;
	idleMs: number;
	requireEndPunctuation: boolean;
	minChars: number;
	monthlyBudgetUsd: number;
	dailyBudgetUsd: number;
	priceUsdPerMTok: number;
	timeoutMs: number;
	requireZdr: boolean;
	/** Slash commands (no slash, lower case) whose argument is a prompt. */
	promptCommands: readonly string[];
};

/** The questions Jev is asked: task type plus one score question per dimension. */
export type Questions = Readonly<Record<"task_type" | Dimension, JevQuestion>>;
/** Per task type, how much each dimension counts. */
export type Weights = Readonly<
	Record<TaskType, Readonly<Record<Dimension, number>>>
>;
export type Rubric = { questions: Questions; weights: Weights };

/** The `state` object sent to Jev (spec 4.3). */
export type JevState = {
	draft: string;
	previous_user_prompt: string;
	last_assistant_reply: string;
	project_instructions: string;
};

/** One Jev question as the decisions API takes it. */
export type JevLevel = string | { what: string; examples: readonly string[] };
export type JevQuestion =
	| {
			type: "choice";
			instructions: string;
			criteria: Readonly<Record<string, string>>;
	  }
	| { type: "score"; instructions: string; criteria: readonly JevLevel[] };

/** Answers after the response check in src/jev.ts. */
export type ScoreAnswer = {
	type: "score";
	score: number;
	confidence: number;
	probabilities: Readonly<Record<string, number>>;
};
export type ChoiceAnswer = {
	type: "choice";
	choice: string;
	confidence: number;
	probabilities: Readonly<Record<string, number>>;
};
export type Answers = { task_type: ChoiceAnswer } & Record<
	Dimension,
	ScoreAnswer
>;

/** What src/grade.ts makes of the answers (spec 4.7). */
export type DimensionResult = {
	/** normalised score, 0..1 */
	s: number;
	/** blended weight, 0..1 */
	w: number;
	confidence: number;
};
export type Grade = {
	/** 0..100 */
	grade: number;
	/** most probable task type */
	type: TaskType;
	typeProbabilities: Readonly<Record<TaskType, number>>;
	/** up to 2, most important first */
	gaps: readonly Dimension[];
	/** false when the weighted mean confidence is below 0.4 */
	certain: boolean;
	dimensions: Readonly<Record<Dimension, DimensionResult>>;
};

/** Spend totals kept in $.store (spec 4.6). */
export type Spend = {
	/** local date, YYYY-MM-DD */
	day: string;
	dayUsd: number;
	/** local month, YYYY-MM */
	month: string;
	monthUsd: number;
	/**
	 * Estimates reserved by calls still in flight, by request id, so a second
	 * call sees them. Settled (removed) when the call lands.
	 */
	pending: Readonly<Record<string, { usd: number; at: number }>>;
};

/** Every outcome of one jevCall (spec 4.6, 4.11). */
export type JevOutcome =
	| { kind: "ok"; answers: Answers; costUsd: number }
	| { kind: "budget" }
	| { kind: "offline" }
	| { kind: "key-rejected" }
	| { kind: "rate-limited" }
	| { kind: "zdr-unavailable" }
	| { kind: "unexpected"; body: string };
