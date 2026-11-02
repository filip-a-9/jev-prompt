// The plugin test sandbox cannot read files or import JSON, so this one check
// runs under node's own runner (`npm test` chains it after the plugin suite).
import assert from "node:assert/strict";
// Imports rubric.ts directly (node type stripping): it must keep only type imports.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CALIBRATED_MODEL } from "../src/rubric.ts";

test("the manifest's model default is CALIBRATED_MODEL", () => {
	const manifest = JSON.parse(
		readFileSync(
			new URL("../.claude-plugin/plugin.json", import.meta.url),
			"utf8",
		),
	);
	assert.equal(manifest.userConfig.model.default, CALIBRATED_MODEL);
});
