import { describe, expect, test } from "claude-code/testing";
import { buildState, headCut, tailCut } from "../src/context";

const KB = 1024;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const base = { draft: "", messages: [], instructionFiles: ["", "", ""] };

describe("message selection", () => {
	test("previous prompt is the last user row with text, skipping tool-result rows", () => {
		const s = buildState({
			...base,
			messages: [
				{ role: "user", text: "first" },
				{ role: "assistant", text: "reply" },
				{ role: "user", text: "second" },
				{ role: "assistant", text: "later reply" },
				{ role: "user", text: "  \n" },
			],
		});
		expect(s.previous_user_prompt).toBe("second");
	});

	test("last reply is the last assistant row with text, skipping tool-only rows", () => {
		const s = buildState({
			...base,
			messages: [
				{ role: "assistant", text: "the real reply" },
				{ role: "user", text: "ok" },
				{ role: "assistant", text: "" },
				{ role: "assistant", text: " \t" },
			],
		});
		expect(s.last_assistant_reply).toBe("the real reply");
	});

	test("everything missing gives empty strings", () => {
		expect(buildState(base)).toEqual({
			draft: "",
			previous_user_prompt: "",
			last_assistant_reply: "",
			project_instructions: "",
		});
	});
});

describe("per-field caps", () => {
	test("previous prompt keeps its first 1 KB", () => {
		const s = buildState({
			...base,
			messages: [{ role: "user", text: `${"a".repeat(KB)}${"b".repeat(10)}` }],
		});
		expect(s.previous_user_prompt).toBe("a".repeat(KB));
	});

	test("assistant reply keeps its last 3 KB", () => {
		const s = buildState({
			...base,
			messages: [
				{ role: "assistant", text: `${"x".repeat(10)}${"y".repeat(3 * KB)}` },
			],
		});
		expect(s.last_assistant_reply).toBe("y".repeat(3 * KB));
	});

	test("instructions skip empty files, join with a blank line", () => {
		const s = buildState({
			...base,
			instructionFiles: ["one", "", "three"],
		});
		expect(s.project_instructions).toBe("one\n\nthree");
	});

	test("instructions keep their first 6 KB", () => {
		const s = buildState({
			...base,
			instructionFiles: [`${"i".repeat(6 * KB)}tail`, "", ""],
		});
		expect(s.project_instructions).toBe("i".repeat(6 * KB));
	});

	test("a draft over 10 KB is cut to its first 10 KB", () => {
		const s = buildState({ ...base, draft: `${"d".repeat(10 * KB)}zzz` });
		expect(s.draft).toBe("d".repeat(10 * KB));
	});

	test("a draft under the cap is untouched", () => {
		expect(buildState({ ...base, draft: "fix the bug" }).draft).toBe(
			"fix the bug",
		);
	});
});

describe("total budget of 16 KB", () => {
	test("full fields overflow by 4 KB, taken from instructions only", () => {
		const s = buildState({
			draft: "d".repeat(10 * KB),
			messages: [
				{ role: "user", text: "u".repeat(KB) },
				{ role: "assistant", text: "a".repeat(3 * KB) },
			],
			instructionFiles: ["i".repeat(6 * KB), "", ""],
		});
		expect(s.draft).toBe("d".repeat(10 * KB));
		expect(s.previous_user_prompt).toBe("u".repeat(KB));
		expect(s.last_assistant_reply).toBe("a".repeat(3 * KB));
		expect(s.project_instructions).toBe("i".repeat(2 * KB));
	});

	test("a smaller overflow trims instructions by exactly the excess", () => {
		const s = buildState({
			draft: "d".repeat(8 * KB),
			messages: [
				{ role: "user", text: "u".repeat(KB) },
				{ role: "assistant", text: "a".repeat(3 * KB) },
			],
			instructionFiles: ["i".repeat(6 * KB), "", ""],
		});
		expect(s.project_instructions).toBe("i".repeat(4 * KB));
	});

	test("no trimming when the total fits", () => {
		const s = buildState({
			draft: "d".repeat(5 * KB),
			messages: [{ role: "assistant", text: "a".repeat(3 * KB) }],
			instructionFiles: ["i".repeat(6 * KB), "", ""],
		});
		expect(s.project_instructions).toBe("i".repeat(6 * KB));
	});

	test("trimmed instructions stay on a code point boundary", () => {
		// 10 KB draft + 3 KB reply + 1 KB prompt leaves 2 KB for instructions;
		// "é" is 2 bytes so the cut lands exactly between characters.
		const s = buildState({
			draft: "d".repeat(10 * KB),
			messages: [
				{ role: "user", text: "u".repeat(KB) },
				{ role: "assistant", text: "a".repeat(3 * KB) },
			],
			instructionFiles: ["é".repeat(3 * KB), "", ""],
		});
		expect(s.project_instructions).toBe("é".repeat(KB));
	});
});

describe("multibyte boundaries", () => {
	test("headCut drops a 2-byte character that straddles the cap", () => {
		const out = headCut(`a${"é".repeat(600)}`, KB);
		expect(out).toBe(`a${"é".repeat(511)}`);
		expect(bytes(out)).toBe(1023);
	});

	test("headCut drops an emoji that straddles the cap", () => {
		const out = headCut(`a${"😀".repeat(300)}`, KB);
		expect(out).toBe(`a${"😀".repeat(255)}`);
	});

	test("tailCut drops a 2-byte character that straddles the cap", () => {
		const out = tailCut(`${"é".repeat(2000)}a`, 3 * KB);
		expect(out).toBe(`${"é".repeat(1535)}a`);
	});

	test("tailCut drops an emoji that straddles the cap", () => {
		const out = tailCut(`${"😀".repeat(1000)}a`, 3 * KB);
		expect(out).toBe(`${"😀".repeat(767)}a`);
	});

	test("cuts of text already within the cap return it unchanged", () => {
		expect(headCut("héllo", 100)).toBe("héllo");
		expect(tailCut("héllo", 100)).toBe("héllo");
	});

	test("a cap of 0 gives an empty string", () => {
		expect(headCut("abc", 0)).toBe("");
		expect(tailCut("abc", 0)).toBe("");
	});

	test("through buildState a multibyte reply is cut on a boundary", () => {
		const s = buildState({
			...base,
			messages: [{ role: "assistant", text: `${"é".repeat(2000)}a` }],
		});
		expect(s.last_assistant_reply).toBe(`${"é".repeat(1535)}a`);
	});
});
