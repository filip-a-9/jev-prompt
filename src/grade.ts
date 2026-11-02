// Turns Jev's answers into the grade shown in the band (spec 4.7). Pure.

import { levelCount, WEIGHTS } from "./rubric";
import {
	type Answers,
	DIMENSIONS,
	type Dimension,
	type DimensionResult,
	type Grade,
	TASK_TYPES,
	type TaskType,
} from "./types";

/** A gap needs at least this blended weight (spec 4.7). */
const GAP_MIN_WEIGHT = 0.1;
/** A gap needs a normalised score below this. */
const GAP_MAX_SCORE = 0.5;
/** Up to this many gaps are shown. */
const GAP_COUNT = 3;
/** Below this weighted mean confidence the grade is shown as uncertain. */
const MIN_CONFIDENCE = 0.4;
/** Blended weights are sums of products, so 0.10 may land a hair under it. */
const EPSILON = 1e-9;

/** Jev's type probabilities over TASK_TYPES, summing to 1. */
function typeProbabilities(answers: Answers): Record<TaskType, number> {
	const raw = answers.task_type.probabilities;
	const known = TASK_TYPES.map((t) => raw[t] ?? 0);
	const sum = known.reduce((a, b) => a + b, 0);
	const said = answers.task_type.choice;
	const choice = TASK_TYPES.find((t) => t === said) ?? "other";
	return Object.fromEntries(
		TASK_TYPES.map((t, i) => [
			t,
			sum > 0 ? (known[i] ?? 0) / sum : t === choice ? 1 : 0,
		]),
	) as Record<TaskType, number>;
}

/** The most probable type; ties go to the first in TASK_TYPES order. */
function mostProbable(p: Record<TaskType, number>): TaskType {
	return TASK_TYPES.reduce((best, t) => (p[t] > p[best] ? t : best));
}

export function gradeAnswers(answers: Answers): Grade {
	const p = typeProbabilities(answers);

	const dimensions = {} as Record<Dimension, DimensionResult>;
	let total = 0;
	let confidence = 0;
	for (const d of DIMENSIONS) {
		const a = answers[d];
		const s = Math.min(1, Math.max(0, a.score / (levelCount(d) - 1)));
		const w = TASK_TYPES.reduce((sum, t) => sum + p[t] * WEIGHTS[t][d], 0);
		dimensions[d] = { s, w, confidence: a.confidence };
		total += w * s;
		confidence += w * a.confidence;
	}

	const shortfall = (d: Dimension) => dimensions[d].w * (1 - dimensions[d].s);
	const gaps = DIMENSIONS.filter(
		(d) =>
			dimensions[d].w >= GAP_MIN_WEIGHT - EPSILON &&
			dimensions[d].s < GAP_MAX_SCORE,
	)
		.sort((a, b) => shortfall(b) - shortfall(a))
		.slice(0, GAP_COUNT);

	return {
		grade: Math.round(100 * total),
		type: mostProbable(p),
		typeProbabilities: p,
		gaps,
		certain: confidence >= MIN_CONFIDENCE,
		dimensions,
	};
}
