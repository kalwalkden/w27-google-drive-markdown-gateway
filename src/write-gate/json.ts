/**
 * Parses JSON while rejecting duplicate object members. JSON.parse accepts those members and
 * silently chooses the last one, which is unsafe for signed security claims.
 */
export function parseJsonWithoutDuplicateKeys(source: string): unknown {
  let cursor = 0;

  const skipWhitespace = (): void => {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  };

  const parseString = (): void => {
    if (source[cursor] !== '"') throw new Error("expected JSON string");
    cursor += 1;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '"') {
        cursor += 1;
        return;
      }
      if (character === "\\") {
        cursor += 1;
        const escapeCharacter = source[cursor];
        if (escapeCharacter === "u") {
          const hex = source.slice(cursor + 1, cursor + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex))
            throw new Error("invalid JSON escape");
          cursor += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escapeCharacter ?? ""))
          throw new Error("invalid JSON escape");
        cursor += 1;
        continue;
      }
      if ((character?.charCodeAt(0) ?? 0) < 0x20)
        throw new Error("invalid JSON control character");
      cursor += 1;
    }
    throw new Error("unterminated JSON string");
  };

  const parseValue = (): void => {
    skipWhitespace();
    const character = source[cursor];
    if (character === '"') {
      parseString();
      return;
    }
    if (character === "{") {
      cursor += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (source[cursor] === "}") {
        cursor += 1;
        return;
      }
      while (true) {
        skipWhitespace();
        const keyStart = cursor;
        parseString();
        const key = JSON.parse(source.slice(keyStart, cursor)) as string;
        if (keys.has(key)) throw new Error("duplicate JSON object member");
        keys.add(key);
        skipWhitespace();
        if (source[cursor] !== ":") throw new Error("expected JSON colon");
        cursor += 1;
        parseValue();
        skipWhitespace();
        if (source[cursor] === "}") {
          cursor += 1;
          return;
        }
        if (source[cursor] !== ",") throw new Error("expected JSON comma");
        cursor += 1;
      }
    }
    if (character === "[") {
      cursor += 1;
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return;
      }
      while (true) {
        parseValue();
        skipWhitespace();
        if (source[cursor] === "]") {
          cursor += 1;
          return;
        }
        if (source[cursor] !== ",") throw new Error("expected JSON comma");
        cursor += 1;
      }
    }
    const primitive =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        source.slice(cursor),
      );
    if (!primitive) throw new Error("invalid JSON value");
    cursor += primitive[0].length;
  };

  parseValue();
  skipWhitespace();
  if (cursor !== source.length) throw new Error("unexpected JSON suffix");
  return JSON.parse(source) as unknown;
}
