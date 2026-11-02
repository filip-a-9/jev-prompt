export type BandView =
	| { kind: "hidden" }
	| { kind: "grading" }
	| { kind: "notice"; text: string; tone: "gray" | "red" }
	| {
			kind: "grade";
			/** speak names gaps; clear says nothing is missing. */
			mode: "speak" | "clear";
			typeLabel: string;
			gaps: readonly string[];
			stale: boolean;
	  };

declare module "claude-code" {
	interface PluginState {
		"jev-prompt": { band: BandView; paused: boolean };
	}
}
