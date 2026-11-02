import { describe, expect, test } from "claude-code/testing";
import { bandLine, GRAY } from "../src/band";

const grade = (
	over: Partial<{
		grade: number;
		certain: boolean;
		gaps: string[];
		stale: boolean;
	}> = {},
) => ({
	kind: "grade" as const,
	grade: 58,
	certain: true,
	typeLabel: "bug fix",
	gaps: ["how to verify", "error output"],
	stale: false,
	...over,
});

describe("bandLine", () => {
	test("a grade shows score, type and missing parts on one line", () => {
		expect(bandLine(grade())?.text).toBe(
			"jev 58%  bug fix  ·  missing: how to verify, error output",
		);
	});

	test("a grade with no gaps leaves out the missing part", () => {
		expect(bandLine(grade({ grade: 91, gaps: [] }))?.text).toBe(
			"jev 91%  bug fix",
		);
	});

	test("an uncertain grade is shown with a tilde", () => {
		expect(bandLine(grade({ certain: false }))?.text).toBe(
			"jev ~58%  bug fix  ·  missing: how to verify, error output",
		);
	});

	test("colour follows the grade: 80 and up green, 50 to 79 yellow, below 50 red", () => {
		expect(bandLine(grade({ grade: 80 }))?.color).toBe("success");
		expect(bandLine(grade({ grade: 79 }))?.color).toBe("warning");
		expect(bandLine(grade({ grade: 50 }))?.color).toBe("warning");
		expect(bandLine(grade({ grade: 49 }))?.color).toBe("error");
	});

	test("a stale grade keeps its text in mid-gray", () => {
		const line = bandLine(grade({ grade: 91, stale: true }));
		expect(line?.color).toBe(GRAY);
		expect(line?.text).toBe(
			"jev 91%  bug fix  ·  missing: how to verify, error output",
		);
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
