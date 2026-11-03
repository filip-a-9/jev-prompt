// Claude Code installs npm dependencies into the plugin cache whenever the
// plugin root holds package.json plus a lockfile, and that cannot be switched
// off. The mod has no runtime dependencies, so the root must hold neither:
// dev tooling lives in dev/.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

const atRoot = (name) => existsSync(new URL(`../${name}`, import.meta.url));

test("the plugin root holds no package manifest or lockfile", () => {
	for (const name of [
		"package.json",
		"package-lock.json",
		"npm-shrinkwrap.json",
		"bun.lock",
	]) {
		assert.equal(atRoot(name), false, `${name} at the plugin root`);
	}
});
