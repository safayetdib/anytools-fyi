import { describe, expect, it } from "vitest";
import { strengthOf } from "./password-input";

describe("strengthOf", () => {
  it("rates longer and more varied passwords higher", () => {
    expect(strengthOf("")).toBe(0);
    expect(strengthOf("1234")).toBe(1);
    expect(strengthOf("sunflower7")).toBe(2);
    expect(strengthOf("correct horse battery")).toBe(3);
    expect(strengthOf("Tr0ub4dor&3")).toBe(3);
  });
});
