import { describe, expect, test } from "claude-code/testing";
import { PATTERNS, redact, redactState } from "../src/redact";

// Fake secrets are built by concatenation so scanners do not fire on this file.
const body = (n: number) => "a1B2".repeat(n);

describe("redact: one test per kind", () => {
	test("anthropic key", () => {
		const k = "sk-" + "ant-api03-" + body(10);
		expect(redact(`key ${k} end`)).toBe("key [REDACTED:anthropic-key] end");
	});
	test("openrouter key", () => {
		const k = "sk-" + "or-v1-" + "a".repeat(64);
		expect(redact(`use ${k}.`)).toBe("use [REDACTED:openrouter-key].");
	});
	test("openai key", () => {
		const k = "sk-" + "proj" + body(10);
		expect(redact(`x ${k}`)).toBe("x [REDACTED:openai-key]");
	});
	test("github classic token", () => {
		const k = "gh" + "p_" + "A".repeat(36);
		expect(redact(`t ${k}`)).toBe("t [REDACTED:github-token]");
	});
	test("github fine-grained token", () => {
		const k = "github" + "_pat_" + "B1".repeat(30);
		expect(redact(`t ${k}`)).toBe("t [REDACTED:github-token]");
	});
	test("aws access key", () => {
		const k = "AK" + "IA" + "ABCDEFGH12345678";
		expect(redact(`id ${k}!`)).toBe("id [REDACTED:aws-key]!");
	});
	test("slack token", () => {
		const k = "xo" + "xb-" + "1234567890-abcdefABCDEF";
		expect(redact(`s ${k}`)).toBe("s [REDACTED:slack-token]");
	});
	test("private key block spans lines", () => {
		const pem =
			"-----BEGIN " +
			"RSA PRIVATE KEY-----\nMIIabc\ndef123==\n-----END " +
			"RSA PRIVATE KEY-----";
		expect(redact(`before\n${pem}\nafter`)).toBe(
			"before\n[REDACTED:private-key]\nafter",
		);
	});
	test("a private key block cut off before its END line is still redacted", () => {
		const head = "-----BEGIN " + "RSA PRIVATE KEY-----\nMIIabc\ndef123==";
		expect(redact(`before\n${head}`)).toBe("before\n[REDACTED:private-key]");
	});
	test("jwt", () => {
		const k =
			"ey" + "JhbGciOiJIUzI1NiJ9." + "ey" + "JzdWIiOiIxMiJ9." + "sig_-abc123";
		expect(redact(`Bearer ${k}`)).toBe("Bearer [REDACTED:jwt]");
	});
	test("assignment with colon", () => {
		expect(redact("password: hunter2 ok")).toBe("[REDACTED:assignment] ok");
	});
	test("assignment with equals, any case, api-key spelling", () => {
		expect(redact("API_KEY=abc and X-api-key = zzz")).toBe(
			"[REDACTED:assignment] and X-[REDACTED:assignment]",
		);
	});
	test("words that merely contain sk- are left alone", () => {
		const words =
			"refactor risk-assessment-framework-document.ts, the task-management-service-handler";
		expect(redact(words)).toBe(words);
	});
	test("url credentials", () => {
		expect(redact("db postgres://user:pw123@host:5432/x")).toBe(
			"db [REDACTED:url-credentials]host:5432/x",
		);
	});
});

describe("redact: precedence", () => {
	test("sk-ant- is labelled anthropic, not openai", () => {
		const k = "sk-" + "ant-" + body(10);
		expect(redact(k)).toBe("[REDACTED:anthropic-key]");
	});
	test("sk-or- is labelled openrouter, not openai", () => {
		const k = "sk-" + "or-" + body(10);
		expect(redact(k)).toBe("[REDACTED:openrouter-key]");
	});
	test("key inside a PEM block does not leave a second marker", () => {
		const pem =
			"-----BEGIN " +
			"PRIVATE KEY-----\ntoken: abc\n-----END " +
			"PRIVATE KEY-----";
		expect(redact(pem)).toBe("[REDACTED:private-key]");
	});
});

describe("redact: left untouched", () => {
	const same = [
		["git sha", "commit 9fceb02d0ae598e95dc970b74767f19372d61af7 done"],
		["uuid", "id 123e4567-e89b-12d3-a456-426614174000"],
		["task-runner", "the task-runner and skip flag"],
		["bare sk-", "prefix sk- alone"],
		["file name", "edit file.ts please"],
		["url without credentials", "see https://example.com/a:b now"],
		["plain prose", "the token budget is large"],
	] as const;
	for (const [name, text] of same) {
		test(name, () => {
			expect(redact(text)).toBe(text);
		});
	}
});

describe("redact: table and state", () => {
	test("every pattern is global so one call redacts all occurrences", () => {
		expect(PATTERNS.length).toBeGreaterThan(0);
		for (const p of PATTERNS) expect(p.re.global).toBe(true);
	});
	test("repeated calls give the same result (no lastIndex leak)", () => {
		const t = "password=abc";
		expect(redact(t)).toBe("[REDACTED:assignment]");
		expect(redact(t)).toBe("[REDACTED:assignment]");
	});
	test("redactState covers every field", () => {
		const out = redactState({
			draft: "token=a",
			previous_user_prompt: "secret: b",
			last_assistant_reply: "passwd=c",
			project_instructions: "api_key=d",
		});
		expect(out).toEqual({
			draft: "[REDACTED:assignment]",
			previous_user_prompt: "[REDACTED:assignment]",
			last_assistant_reply: "[REDACTED:assignment]",
			project_instructions: "[REDACTED:assignment]",
		});
	});
});
