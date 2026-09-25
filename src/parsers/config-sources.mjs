import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from '../files.mjs';

export const instruction = (scope, path) => {
  const text = readText(path);
  return text === null ? [] : [{ scope, path, text }];
};

export const skillDirs = (root, scope) => (existsSync(root)
  ? readdirSync(root, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || d.isSymbolicLink()) && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => ({ name: d.name, scope, path: join(root, d.name) }))
  : []);