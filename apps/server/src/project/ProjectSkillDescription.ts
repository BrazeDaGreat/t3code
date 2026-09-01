import { fromYaml } from "@t3tools/shared/schemaYaml";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeFrontmatter = Schema.decodeUnknownOption(
  fromYaml(
    Schema.Struct({
      description: Schema.String,
    }),
  ),
);
const decodePageMetadata = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      "@type": Schema.Literal("SoftwareApplication"),
      name: Schema.String,
      description: Schema.String,
    }),
  ),
);

function normalizeDescription(value: string): string | null {
  return value.replace(/\s+/g, " ").trim().slice(0, 2048) || null;
}

export function parseSkillDescription(contents: string): string | null {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents);
  if (!frontmatter) return null;
  const decoded = decodeFrontmatter(frontmatter[1]);
  return Option.isSome(decoded) ? normalizeDescription(decoded.value.description) : null;
}

/** Read only the header prefix; large instructions never enter the installed list payload. */
export const readSkillDescription = Effect.fn("readSkillDescription")(
  function* (skillFile: string) {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(skillFile);
    const prefix = yield* file.readAlloc(16 * 1024);
    return Option.isSome(prefix)
      ? parseSkillDescription(new TextDecoder().decode(prefix.value))
      : null;
  },
  Effect.scoped,
  Effect.orElseSucceed(() => null),
);

/** Extract published structured metadata without evaluating or rendering page HTML. */
export function parseSkillPageDescription(html: string, name: string): string | null {
  for (const match of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const decoded = decodePageMetadata(match[1]);
    if (Option.isSome(decoded) && decoded.value.name.toLowerCase() === name.toLowerCase()) {
      return normalizeDescription(decoded.value.description);
    }
  }
  return null;
}
