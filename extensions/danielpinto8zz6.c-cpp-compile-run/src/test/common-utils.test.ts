import * as assert from "assert";
import { isProcessRunning, isWindows } from "../utils/common-utils";
import path = require("path");

suite("Common Utils Test Suite", () => {
    test("isWindows should return a boolean", () => {
        const result = isWindows();
        assert.strictEqual(typeof result, "boolean");
        // Verify it matches the actual platform
        assert.strictEqual(result, process.platform === "win32");
    });

    test("Windows checks the executable path instead of skipping running programs", async function () {
        if (!isWindows()) { this.skip(); }
        this.timeout(15_000);
        assert.strictEqual(await isProcessRunning(process.execPath), true);
        const otherPath = path.join(path.dirname(process.execPath), "nonexistent-shortestpath-test", path.basename(process.execPath));
        assert.strictEqual(await isProcessRunning(otherPath), false);
    });
});
