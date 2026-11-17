import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sporFraVenstre } from "./layout";
import { LINES } from "./lines";

describe("sporvælgeren", () => {
  it("står som tegningen, fra venstre mod højre", () => {
    assert.deepEqual(sporFraVenstre(LINES.sliberi), ["S", "N"]);
    assert.deepEqual(sporFraVenstre(LINES.pillering), ["L1", "L2"]);
    assert.deepEqual(sporFraVenstre(LINES.coating), ["A1", "A2", "A3"]);
  });
});
