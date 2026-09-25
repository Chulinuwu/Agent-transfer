import { existsSync, readFileSync } from 'node:fs';

export const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

export function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`cannot parse ${path}: ${error.message}`);
  }
}