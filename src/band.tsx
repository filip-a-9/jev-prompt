// The band above the prompt (spec 4.8).
import type { BandView } from "../types";

/** Explicit mid-gray. Never `dimColor`: it is black on a black terminal. */
export const GRAY = "ansi256(245)";

export type BandLine = { text: string; color: string };

function gradeColor(grade: number): string {
	if (grade >= 80) return "success";
	if (grade >= 50) return "warning";
	return "error";
}

/** The band's one line, or undefined when the band shows nothing. */
export function bandLine(view: BandView): BandLine | undefined {
	switch (view.kind) {
		case "hidden":
			return undefined;
		case "grading":
			return { text: "jev grading…", color: GRAY };
		case "notice":
			return { text: view.text, color: view.tone === "red" ? "error" : GRAY };
		case "grade": {
			const score = `jev ${view.certain ? "" : "~"}${view.grade}%  ${view.typeLabel}`;
			const text =
				view.gaps.length > 0
					? `${score}  ·  missing: ${view.gaps.join(", ")}`
					: score;
			return { text, color: view.stale ? GRAY : gradeColor(view.grade) };
		}
	}
}
