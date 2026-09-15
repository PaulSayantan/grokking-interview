import { describe, it, expect } from "vitest";
import { cardTitle } from "@lib/domain-title";
import { getDomains } from "@lib/catalog";

describe("cardTitle", () => {
  it("applies the explicit short forms", () => {
    expect(cardTitle("dsa-coding", "Data Structures, Algorithms & Coding Interviews")).toBe(
      "Data Structures & Algorithms",
    );
    expect(cardTitle("lld-and-ood", "Low-Level Design & Object-Oriented Design")).toBe(
      "Low-Level & OO Design",
    );
  });

  it("strips a parenthetical qualifier", () => {
    expect(cardTitle("java-jvm", "Java & JVM (framework-relevant)")).toBe("Java & JVM");
  });

  it("passes short titles through untouched", () => {
    expect(cardTitle("grpc", "gRPC")).toBe("gRPC");
    expect(cardTitle("docker", "Docker")).toBe("Docker");
  });

  it("keeps every real catalog title short and non-empty", () => {
    for (const d of getDomains()) {
      const short = cardTitle(d.slug, d.title);
      expect(short.length).toBeGreaterThan(0);
      expect(short.length).toBeLessThanOrEqual(d.title.length);
      expect(short).not.toContain("(");
    }
  });
});
