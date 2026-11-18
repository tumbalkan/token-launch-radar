// Token launch radar, entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the
// radar-2 model in lib/model.ts, and writes the outputs the gate reads:
//
//   /output/board.json     the ranked board (rows)
//   /output/data.js        the dashboard's dataset, as one script
//   /output/dashboard/    the static page (copied from this repo)
//   /output/screenshots/  the three screenshots (copied from this repo)
//   /output/dossier.json  the judge's dossier, via vendor/makefun-board.ts
//
// The program runs twice and both runs must write the same bytes: every
// step below is deterministic (sorted iteration, no clock, no random).
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));

/** The gate's caps for the dossier (reference/gate.json). */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Die with a message on stderr and a non-zero exit. */
function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value of `--name <value>` or `--name=<value>`, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === `--${name}` && i + 1 < args.length) return args[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

/** Resolve the snapshot path: a file, or a directory holding snapshot.json. */
function snapshotPath(): string {
  const given = flagValue('input', '/input');
  const file = given.endsWith('.json') ? given : join(given, 'snapshot.json');
  if (!existsSync(file)) fail(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  return file;
}

/** The output directory: --output, else MAKEFUN_OUTPUT_DIR, else /output. */
function outputDir(): string {
  return flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** Copy a directory's regular files (dot-names skipped) into `dest`. */
function copyDir(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(src).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(src, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(dest, name));
    names.push(name);
  }
  return names;
}

const snap = parseSnapshot(readFileSync(snapshotPath(), 'utf8'));
const { board, radar } = buildRadar(snap);
const problem = boardIssue(board, snap);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

const out = outputDir();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashFiles = copyDir(join(repoRoot, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) fail('dashboard/ holds no files: hand in index.html, a .css and a .js file');
const shots = copyDir(join(repoRoot, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
