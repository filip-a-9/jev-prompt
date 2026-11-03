// The README's settings table must list every userConfig key once, with the
// manifest's default. Cells are compared, not prose. Runs under node's runner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(read("../.claude-plugin/plugin.json"));

const cells = (line) =>
	line
		.trim()
		.replace(/^\||\|$/g, "")
		.split("|")
		.map((c) => c.trim());
const strip = (c) => c.replace(/^`|`$/g, "");

// Rows of the table whose first header cell is "Key".
function settingsRows() {
	const lines = read("../README.md").split("\n");
	const start = lines.findIndex(
		(l) => l.trim().startsWith("|") && cells(l)[0] === "Key",
	);
	assert.notEqual(start, -1, "README has no table with a `Key` header");
	const header = cells(lines[start]);
	assert.equal(header[1], "Default");
	const rows = [];
	for (let i = start + 2; i < lines.length; i++) {
		if (!lines[i].trim().startsWith("|")) break;
		const c = cells(lines[i]);
		assert.ok(c.length >= 2, `settings row ${i + 1} has fewer than 2 cells`);
		rows.push({ key: strip(c[0]), default: strip(c[1]) });
	}
	return rows;
}

test("the settings table has exactly one row per userConfig key", () => {
	const keys = settingsRows().map((r) => r.key);
	assert.deepEqual(keys.sort(), Object.keys(manifest.userConfig).sort());
});

test("each settings row's default equals the manifest's", () => {
	for (const row of settingsRows()) {
		const def = manifest.userConfig[row.key].default;
		if (def === undefined) {
			assert.equal(row.default, "—", `${row.key} has no default`);
		} else {
			assert.equal(row.default, String(def), `${row.key} default`);
		}
	}
});
