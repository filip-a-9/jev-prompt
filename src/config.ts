import type { Config } from "./types";

export const DEFAULTS: Config = {
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
};

const nonNegative = (v: unknown, fallback: number): number =>
	typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;

const bool = (v: unknown, fallback: boolean): boolean =>
	typeof v === "boolean" ? v : fallback;

const text = (v: unknown): string | undefined => {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t === "" ? undefined : t;
};

/** The only place that reads plugin options. Never throws. */
export function parseConfig(
	options: Readonly<Record<string, unknown>>,
): Config {
	return {
		apiKey: text(options.openrouterApiKey),
		model: text(options.model) ?? DEFAULTS.model,
		idleMs: nonNegative(options.idleMs, DEFAULTS.idleMs),
		requireEndPunctuation: bool(
			options.requireEndPunctuation,
			DEFAULTS.requireEndPunctuation,
		),
		minChars: nonNegative(options.minChars, DEFAULTS.minChars),
		monthlyBudgetUsd: nonNegative(
			options.monthlyBudgetUsd,
			DEFAULTS.monthlyBudgetUsd,
		),
		dailyBudgetUsd: nonNegative(
			options.dailyBudgetUsd,
			DEFAULTS.dailyBudgetUsd,
		),
		priceUsdPerMTok: nonNegative(
			options.priceUsdPerMTok,
			DEFAULTS.priceUsdPerMTok,
		),
		timeoutMs: nonNegative(options.timeoutMs, DEFAULTS.timeoutMs),
		requireZdr: bool(options.requireZdr, DEFAULTS.requireZdr),
	};
}
