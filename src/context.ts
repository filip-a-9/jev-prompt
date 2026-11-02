import type { JevState } from "./types";

export const INSTRUCTION_PATHS = [
	"CLAUDE.md",
	"CLAUDE.local.md",
	".claude/CLAUDE.md",
] as const;
export type MessageRow = { role: "user" | "assistant"; text: string };

const KB = 1024;
const CAP = {
	draft: 10 * KB,
	previous: 1 * KB,
	reply: 3 * KB,
	instructions: 6 * KB,
	total: 16 * KB,
};

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/** Keep the start of `text`, at most `maxBytes` UTF-8 bytes, whole code points. */
export function headCut(text: string, maxBytes: number): string {
	let used = 0;
	let end = 0;
	for (const ch of text) {
		const n = byteLength(ch);
		if (used + n > maxBytes) break;
		used += n;
		end += ch.length;
	}
	return text.slice(0, end);
}

/** Keep the end of `text`, at most `maxBytes` UTF-8 bytes, whole code points. */
export function tailCut(text: string, maxBytes: number): string {
	let used = 0;
	let start = text.length;
	for (let i = text.length; i > 0; ) {
		const cp = text.codePointAt(i - 1);
		const unit =
			cp !== undefined && cp >= 0xdc00 && cp <= 0xdfff && i > 1 ? 2 : 1;
		const ch = text.slice(i - unit, i);
		const n = byteLength(ch);
		if (used + n > maxBytes) break;
		used += n;
		i -= unit;
		start = i;
	}
	return text.slice(start);
}

function lastWithText(
	messages: readonly MessageRow[],
	role: MessageRow["role"],
): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m?.role === role && m.text.trim() !== "") return m.text;
	}
	return "";
}

export function buildState(input: {
	draft: string;
	messages: readonly MessageRow[];
	instructionFiles: readonly string[];
}): JevState {
	const draft = headCut(input.draft, CAP.draft);
	let previous = headCut(lastWithText(input.messages, "user"), CAP.previous);
	let reply = tailCut(lastWithText(input.messages, "assistant"), CAP.reply);
	let instructions = headCut(
		input.instructionFiles.filter((f) => f !== "").join("\n\n"),
		CAP.instructions,
	);

	// Over budget: shrink instructions, then reply, then previous prompt.
	const excess = () =>
		byteLength(draft) +
		byteLength(previous) +
		byteLength(reply) +
		byteLength(instructions) -
		CAP.total;
	const shrink = (text: string, cut: typeof headCut) =>
		excess() > 0 ? cut(text, Math.max(0, byteLength(text) - excess())) : text;
	instructions = shrink(instructions, headCut);
	reply = shrink(reply, tailCut);
	previous = shrink(previous, headCut);

	return {
		draft,
		previous_user_prompt: previous,
		last_assistant_reply: reply,
		project_instructions: instructions,
	};
}
