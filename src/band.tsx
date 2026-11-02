// The band above the prompt (spec 4.8).
import type { BandView } from "../types";
import type { Grade } from "./types";

/** Explicit mid-gray. Never `dimColor`: it is black on a black terminal. */
export const GRAY = "ansi256(245)";

// The band's rules, in one place (spec 4.8).
/** Task type the band stays quiet for: its label agrees with humans 18%. */
export const QUIET_TYPE = "other";
/** Colour of a line that names gaps. */
export const SPEAK_COLOR = "warning";

export type BandDecision = "speak" | "clear" | "quiet";

/** Why the band is quiet for this grade; undefined if it would show. */
export function quietReason(g: Grade): "uncertain" | "type other" | undefined {
	if (!g.certain) return "uncertain";
	if (g.type === QUIET_TYPE) return "type other";
	return undefined;
}

/** What the band does for a grade: name gaps, say clear, or stay hidden. */
export function bandDecision(g: Grade): BandDecision {
	if (quietReason(g)) return "quiet";
	return g.gaps.length > 0 ? "speak" : "clear";
}

export type BandLine = { text: string; color: string };

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
			const head = `jev  ${view.typeLabel}  ·  `;
			if (view.mode === "clear") {
				return { text: `${head}clear`, color: GRAY };
			}
			return {
				text: `${head}missing: ${view.gaps.join(", ")}`,
				color: view.stale ? GRAY : SPEAK_COLOR,
			};
		}
	}
}
