import { describe, expect, it } from "vitest";
import projects from "../../messages/en/projects.json";
import library from "../../messages/en/library.json";
import boqs from "../../messages/en/boqs.json";
import models from "../../messages/en/models.json";

/** TF-025 (screens.md "empty: explains the next action"): an empty list says what to do next, not only that it is empty. */
describe("empty states name the next action", () => {
  it.each([
    ["projects.list.empty", projects.list.empty],
    ["projects.overview.noModels", projects.overview.noModels],
    ["projects.overview.noBoqs", projects.overview.noBoqs],
    ["library.home.empty", library.home.empty],
    ["library.home.emptyProject", library.home.emptyProject],
    ["boqs.exports.none", boqs.exports.none],
    ["models.list.empty", models.list.empty],
  ])("%s", (_key, text) => {
    // More than the bare fact: a second clause or sentence with the action.
    expect(text.split(/[.:]\s+/).filter(Boolean).length, text).toBeGreaterThan(1);
  });
});
