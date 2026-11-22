import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Docker refuses an image reference with capitals in it ("repository name
// must be lowercase"), so the README's compose snippet failed for anyone who
// copied it as is (#60). Every place a user copies the image name from must
// spell it in lowercase.
const ROOT = resolve(import.meta.dirname, '../..');
const FILES = ['README.md', 'docs/index.html', 'docs/FAQ.md', 'docker-compose.yml', 'docs/unraid/patzer.xml'];

describe('published image name (#60)', () => {
  for (const file of FILES) {
    it(`${file} spells every ghcr.io image in lowercase`, () => {
      const src = readFileSync(resolve(ROOT, file), 'utf8');
      const refs = src.match(/ghcr\.io\/[^\s:<"'`)]+/g) ?? [];
      for (const ref of refs) expect(ref).toBe(ref.toLowerCase());
    });
  }
});
