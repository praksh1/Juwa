/**
 * Concatenate every migration into one file.
 *
 * Supabase's SQL editor is a single text box. Pasting five files in the right
 * order is five chances to paste the wrong one, or the same one twice — and a
 * migration run out of order fails in ways that are confusing to unpick. One
 * file removes the sequencing decision entirely.
 *
 *   node scripts/build-migration.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'db', 'migrations');

const files = readdirSync(dir)
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort();

const header = `-- ============================================================================
-- Juwa — complete schema.
--
-- GENERATED FILE. Do not edit; edit db/migrations/*.sql and re-run
-- \`node scripts/build-migration.mjs\`.
--
-- Paste the whole thing into the Supabase SQL editor and run it once. It is
-- every migration below, in order:
${files.map((f) => `--   ${f}`).join('\n')}
--
-- Safe to run on a fresh project. Running it twice will error on the first
-- CREATE TABLE, which is the correct behaviour — it means the schema is
-- already there.
-- ============================================================================

`;

const body = files
  .map((name) => {
    const sql = readFileSync(join(dir, name), 'utf8');
    return `\n-- ${'='.repeat(74)}\n-- ${name}\n-- ${'='.repeat(74)}\n\n${sql}`;
  })
  .join('\n');

const out = join(dir, 'ALL.sql');
writeFileSync(out, header + body);
console.log(`Wrote ${out} from ${files.length} migrations (${(header + body).length} bytes)`);
