import { describe, expect, it } from "@effect/vitest";
import { parseSkillDescription, parseSkillPageDescription } from "./ProjectSkillDescription.ts";

describe("skill descriptions", () => {
  it("reads quoted and multiline YAML descriptions, including Windows files", () => {
    expect(
      parseSkillDescription(
        '---\nname: sample\ndescription: "Review React code: catch regressions."\n---\nInstructions',
      ),
    ).toBe("Review React code: catch regressions.");
    expect(
      parseSkillDescription(
        "\uFEFF---\r\nname: sample\r\ndescription: >-\r\n  Review React code\r\n  and catch regressions.\r\n---\r\nInstructions",
      ),
    ).toBe("Review React code and catch regressions.");
  });

  it("does not invent descriptions from missing, malformed, or non-string metadata", () => {
    for (const content of [
      "# Instructions",
      "---\nname: sample\n---\nBody",
      "---\ndescription: [invalid\n---\n",
      "---\ndescription: true\n---\n",
      "---\ndescription: '   '\n---\n",
    ]) {
      expect(parseSkillDescription(content)).toBeNull();
    }
  });

  it("bounds descriptions before sending them to a client", () => {
    expect(parseSkillDescription(`---\ndescription: ${"a".repeat(3000)}\n---\n`)).toHaveLength(
      2048,
    );
  });

  it("reads only the requested skill's structured metadata from a detail page", () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite","name":"Skills","description":"Directory description"}</script>
      <script type="application/ld+json">{"@type":"SoftwareApplication","name":"other","description":"Wrong skill"}</script>
      <script type="application/ld+json">not json</script>
      <script nonce="test" type='application/ld+json'>{"@type":"SoftwareApplication","name":"sample","description":"Review code & catch regressions."}</script>`;
    expect(parseSkillPageDescription(html, "sample")).toBe("Review code & catch regressions.");
    expect(parseSkillPageDescription(html, "missing")).toBeNull();
    expect(
      parseSkillPageDescription('<meta name="description" content="Generic directory">', "sample"),
    ).toBeNull();
  });
});
