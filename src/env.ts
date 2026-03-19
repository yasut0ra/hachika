import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadDotEnv(filePath = resolve(process.cwd(), ".env")): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const source = readFileSync(filePath, "utf8");
  const loaded: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const parsed = parseDotEnvLine(line);

    if (!parsed) {
      continue;
    }

    if (process.env[parsed.key] !== undefined) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
    loaded.push(parsed.key);
  }

  return loaded;
}

export function parseDotEnvLine(
  line: string,
): { key: string; value: string } | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

  if (!match) {
    return null;
  }

  const key = match[1];
  const rawValue = match[2] ?? "";

  if (!key) {
    return null;
  }

  const value = parseDotEnvValue(rawValue);

  return {
    key,
    value,
  };
}

function parseDotEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);
    return quote === '"' ? unescapeDoubleQuotedValue(inner) : inner;
  }

  const commentIndex = trimmed.search(/\s#/);
  const value = commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed;
  return value.trim();
}

function unescapeDoubleQuotedValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}
