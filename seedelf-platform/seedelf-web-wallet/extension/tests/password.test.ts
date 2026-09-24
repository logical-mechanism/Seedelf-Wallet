import { describe, expect, it } from "vitest";

import { MIN_PASSWORD_LENGTH, passwordProblem, passwordStrength } from "../src/shared/password";

describe("password rule", () => {
  it("needs at least 12 characters and nothing else", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem("elevenchars")).toContain("at least 12 characters (11 so far)");
    expect(passwordProblem("twelve chars")).toBeUndefined();
    expect(passwordProblem("aaaaaaaaaaaa")).toBeUndefined();
    // Characters, not UTF-16 code units.
    expect(passwordProblem("🌱".repeat(11))).toContain("11 so far");
  });

  it("gives a rough strength hint", () => {
    expect(passwordStrength("aaaaaaaaaaaa")).toBe("weak");
    expect(passwordStrength("passwordpassword")).toBe("weak");
    expect(passwordStrength("twelve chars")).toBe("fair");
    expect(passwordStrength("Tr0ub4dor&3xyz")).toBe("good");
    expect(passwordStrength("correct horse battery staple")).toBe("strong");
  });
});
