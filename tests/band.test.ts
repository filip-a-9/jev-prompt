import { describe, expect, test } from "claude-code/testing";
import { bandDecision, bandLine, GRAY, quietReason } from "../src/band";
import type { Grade } from "../src/types";

const view = (
	over: Partial<{
		mode: "speak" | "clear";
		gaps: string[];
		stale: boolean;
	}> = {},
) => ({
	kind: "grade" as const,
	mode: "speak" as const,
	typeLabel: "bug fix",
	gaps: ["how to verify", "error output"],
	stale: false,
	...over,
});

const grade = (over: Partial<Grade> = {}): Grade => ({
	grade: 58,
	type: "bug_fix",
	typeProbabilities: {} as Grade["typeProbabilities"],
	gaps: ["verification"],
	certain: true,
	dimensions: {} as Grade["dimensions"],
	...over,
});

describe("bandDecision", () => {
	test("certain, a real type and a gap: speak", () => {
		expect(bandDecision(grade())).toBe("speak");
	});

	test("certain, a real type and no gap: clear", () => {
		expect(bandDecision(grade({ gaps: [] }))).toBe("clear");
	});

	test("an uncertain grade is quiet, with or without gaps", () => {
		expect(bandDecision(grade({ certain: false }))).toBe("quiet");
		expect(bandDecision(grade({ certain: false, gaps: [] }))).toBe("quiet");
		expect(quietReason(grade({ certain: false }))).toBe("uncertain");
	});

	test("type other is quiet, with or without gaps", () => {
		expect(bandDecision(grade({ type: "other" }))).toBe("quiet");
		expect(bandDecision(grade({ type: "other", gaps: [] }))).toBe("quiet");
		expect(quietReason(grade({ type: "other" }))).toBe("type other");
	});

	test("uncertain wins over type other as the reason", () => {
		expect(quietReason(grade({ certain: false, type: "other" }))).toBe(
			"uncertain",
		);
	});

	test("a shown grade has no quiet reason", () => {
		expect(quietReason(grade())).toBeUndefined();
		expect(quietReason(grade({ gaps: [] }))).toBeUndefined();
	});
});

describe("bandLine", () => {
	test("speak names the type and what is missing, in the warning colour", () => {
		expect(bandLine(view())).toEqual({
			text: "jev  bug fix  ·  missing: how to verify, error output",
			color: "warning",
		});
	});

	test("clear says so, in gray", () => {
		expect(bandLine(view({ mode: "clear", gaps: [] }))).toEqual({
			text: "jev  bug fix  ·  clear",
			color: GRAY,
		});
	});

	test("no band line carries a digit, a tilde or a percent sign", () => {
		const lines = [
			bandLine(view()),
			bandLine(view({ mode: "clear", gaps: [] })),
			bandLine(view({ stale: true })),
		];
		for (const l of lines) expect(l?.text).not.toMatch(/[0-9~%]/);
	});

	test("typing turns a speak line gray and keeps its text", () => {
		const fresh = bandLine(view());
		const stale = bandLine(view({ stale: true }));
		expect(stale?.color).toBe(GRAY);
		expect(stale?.text).toBe(fresh?.text);
	});

	test("typing keeps a clear line gray", () => {
		expect(
			bandLine(view({ mode: "clear", gaps: [], stale: true }))?.color,
		).toBe(GRAY);
	});

	test("grading and gray notices are mid-gray, red notices red", () => {
		expect(bandLine({ kind: "grading" })).toEqual({
			text: "jev grading…",
			color: GRAY,
		});
		expect(
			bandLine({ kind: "notice", text: "jev: offline", tone: "gray" }),
		).toEqual({ text: "jev: offline", color: GRAY });
		expect(
			bandLine({ kind: "notice", text: "jev: key rejected", tone: "red" })
				?.color,
		).toBe("error");
	});

	test("hidden shows nothing", () => {
		expect(bandLine({ kind: "hidden" })).toBeUndefined();
	});

	test("the gray is an explicit 256-colour mid-gray, never a dim style", () => {
		expect(GRAY).toBe("ansi256(245)");
	});
});
