export type BandView =
	| { kind: "hidden" }
	| { kind: "grading" }
	| { kind: "notice"; text: string; tone: "gray" | "red" }
	| {
			kind: "grade";
			grade: number;
			certain: boolean;
			typeLabel: string;
			gaps: readonly string[];
			stale: boolean;
	  };

declare module "claude-code" {
	interface PluginState {
		"jev-prompt": { band: BandView; paused: boolean };
	}
}
