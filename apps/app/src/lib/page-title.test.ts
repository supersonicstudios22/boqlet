// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { pageTitleFor } from "./page-title";

/** TF-167 (WCAG 2.4.2): each page has its own title, the deepest level shown wins. */
describe("page titles", () => {
  it("names the page, then what it is in, then the product", () => {
    expect(pageTitleFor([{ depth: 1, parts: ["Acme"] }, { depth: 2, parts: ["Models", "Duplex", "Acme"] }, { depth: 3, parts: ["Duplex BoQ", "Sheet", "Duplex", "Acme"] }])).toBe("Duplex BoQ · Sheet · Duplex · Acme · boqlet");
    expect(pageTitleFor([{ depth: 1, parts: ["Acme"] }])).toBe("Acme · boqlet");
    expect(pageTitleFor([])).toBe("boqlet");
  });
});
