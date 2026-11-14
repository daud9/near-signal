import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'dist');

// Runtime modules are copied because index.html loads them as browser ESM imports.
// Markdown files are limited to the evidence/methodology links reachable from the app.
export const VERCEL_PUBLIC_FILES = Object.freeze([
  'index.html',
  'favicon.svg',
  'src/analytics.js',
  'src/app.js',
  'src/data.js',
  'src/query-registry.js',
  'src/replay.js',
  'src/thesis.js',
  'src/workspace.css',
  'src/workspace.js',
  'THESIS.md',
  'docs/alternative-data-infrastructure.md',
  'docs/data-sources.md',
  'docs/methodology.md',
  'docs/track-alignment.md',
  'docs/risk-radar-research/01-defi-yield.md',
  'docs/risk-radar-research/02-contract-admin.md',
  'docs/risk-radar-research/03-liquidity-assets.md',
  'docs/risk-radar-research/04-bridges-intents.md',
  'docs/risk-radar-research/05-validators.md',
  'docs/risk-radar-research/06-network.md',
  'docs/risk-radar-research/07-tokenomics.md',
  'docs/risk-radar-research/README.md',
]);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function buildVercelStaticOutput(outputDirectory = DEFAULT_OUTPUT) {
  const output = path.resolve(outputDirectory);
  if (isWithin(output, PROJECT_ROOT)) {
    throw new Error('Vercel output directory cannot be the project root or its ancestor');
  }
  if (isWithin(PROJECT_ROOT, output) && output !== DEFAULT_OUTPUT) {
    throw new Error('The only supported in-project Vercel output directory is dist/');
  }

  rmSync(output, { recursive: true, force: true });
  for (const relativePath of VERCEL_PUBLIC_FILES) {
    const source = path.join(PROJECT_ROOT, relativePath);
    const sourceStat = lstatSync(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Allowlisted public file is missing or not a regular file: ${relativePath}`);
    }
    const destination = path.join(output, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = buildVercelStaticOutput();
  if (!existsSync(path.join(output, 'index.html'))) {
    throw new Error('Vercel static output is missing index.html');
  }
  console.log(`Built ${VERCEL_PUBLIC_FILES.length} allowlisted public files in ${path.relative(PROJECT_ROOT, output)}/`);
}
