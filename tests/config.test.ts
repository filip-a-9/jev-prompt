import { describe, expect, test } from "claude-code/testing";
import { DEFAULTS, parseConfig } from "../src/config";

describe("parseConfig", () => {
	test("empty options give the documented defaults", () => {
		expect(parseConfig({})).toEqual({
			apiKey: undefined,
			model: "typesafe/jev-1.14",
			idleMs: 10000,
			requireEndPunctuation: false,
			minChars: 10,
			monthlyBudgetUsd: 1.65,
			dailyBudgetUsd: 0.1,
			priceUsdPerMTok: 0.042,
			timeoutMs: 3000,
			requireZdr: true,
			promptCommands: ["goal", "loop"],
		});
	});
	test("DEFAULTS equals parseConfig({})", () => {
		expect(DEFAULTS.idleMs).toBe(10000);
		expect(DEFAULTS.requireZdr).toBe(true);
	});
	test("valid values are taken, openrouterApiKey maps to apiKey", () => {
		expect(
			parseConfig({
				openrouterApiKey: "  k1  ",
				model: " m/x ",
				idleMs: 500,
				requireEndPunctuation: true,
				minChars: 0,
				monthlyBudgetUsd: 5,
				dailyBudgetUsd: 0,
				priceUsdPerMTok: 0.5,
				timeoutMs: 1000,
				requireZdr: false,
				promptCommands: "schedule",
			}),
		).toEqual({
			apiKey: "k1",
			model: "m/x",
			idleMs: 500,
			requireEndPunctuation: true,
			minChars: 0,
			monthlyBudgetUsd: 5,
			dailyBudgetUsd: 0,
			priceUsdPerMTok: 0.5,
			timeoutMs: 1000,
			requireZdr: false,
			promptCommands: ["schedule"],
		});
	});
	test("promptCommands is split, trimmed, lower-cased and stripped of empties", () => {
		expect(
			parseConfig({ promptCommands: " Goal , loop,," }).promptCommands,
		).toEqual(["goal", "loop"]);
	});
	test("a leading slash on a promptCommands entry is dropped", () => {
		expect(
			parseConfig({ promptCommands: "/goal, /Loop" }).promptCommands,
		).toEqual(["goal", "loop"]);
	});
	test("a non-string promptCommands falls back; an empty string means none", () => {
		expect(parseConfig({ promptCommands: 7 }).promptCommands).toEqual([
			"goal",
			"loop",
		]);
		expect(parseConfig({ promptCommands: "" }).promptCommands).toEqual([]);
	});
	test("blank or non-string apiKey is undefined", () => {
		expect(parseConfig({ openrouterApiKey: "   " }).apiKey).toBeUndefined();
		expect(parseConfig({ openrouterApiKey: 42 }).apiKey).toBeUndefined();
	});
	test("a field named apiKey in options is ignored", () => {
		expect(parseConfig({ apiKey: "x" }).apiKey).toBeUndefined();
	});
	test("blank or non-string model falls back", () => {
		expect(parseConfig({ model: "  " }).model).toBe("typesafe/jev-1.14");
		expect(parseConfig({ model: 3 }).model).toBe("typesafe/jev-1.14");
	});
	test("bad numbers fall back per field", () => {
		const c = parseConfig({
			idleMs: "500",
			minChars: -1,
			timeoutMs: Number.NaN,
			monthlyBudgetUsd: Number.POSITIVE_INFINITY,
			dailyBudgetUsd: -0.01,
			priceUsdPerMTok: null,
		});
		expect(c.idleMs).toBe(10000);
		expect(c.minChars).toBe(10);
		expect(c.timeoutMs).toBe(3000);
		expect(c.monthlyBudgetUsd).toBe(1.65);
		expect(c.dailyBudgetUsd).toBe(0.1);
		expect(c.priceUsdPerMTok).toBe(0.042);
	});
	test("bad booleans fall back", () => {
		const c = parseConfig({ requireEndPunctuation: "yes", requireZdr: 0 });
		expect(c.requireEndPunctuation).toBe(false);
		expect(c.requireZdr).toBe(true);
	});
	test("unknown keys are ignored and one bad field does not spoil others", () => {
		const c = parseConfig({ bogus: 1, idleMs: -5, minChars: 3 });
		expect(c.minChars).toBe(3);
		expect(c.idleMs).toBe(10000);
		expect("bogus" in c).toBe(false);
	});
});
