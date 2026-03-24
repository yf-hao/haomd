#!/usr/bin/env node
/**
 * Extracts the latest version's changelog block from CHANGELOG.md
 * and writes it to GITHUB_OUTPUT (or stdout if not in CI).
 */

import { readFileSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Always resolve CHANGELOG.md relative to the repo root (parent of /scripts)
const __dirname = dirname(fileURLToPath(import.meta.url));
const changelogPath = resolve(__dirname, '..', 'CHANGELOG.md');

const content = readFileSync(changelogPath, 'utf8');

// Match the first version block from ## [vX.X.X] to just before the next one
const regex = /## \[v\d+\.\d+\.\d+\][\s\S]*?(?=\n## \[v\d+\.\d+\.\d+\]|$)/;
const match = content.match(regex);
const body = match ? match[0].trim() : '';

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  // GitHub Actions multiline output format
  appendFileSync(githubOutput, `body<<EOF\n${body}\nEOF\n`);
  console.log('Changelog extracted and written to GITHUB_OUTPUT.');
} else {
  // Local debug: just print to stdout
  console.log(body);
}
