import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { replayChartInputs } from '../src/replay.js';

const input = resolve(process.argv[2] ?? 'data/latest-evidence.json');
const output = resolve(process.argv[3] ?? 'data/replayed-charts.json');
try {
  const bundle = JSON.parse(await readFile(input, 'utf8'));
  const charts = replayChartInputs(bundle);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(charts, null, 2)}\n`, 'utf8');
  console.log(`Replayed raw evidence from ${input} to ${output}; no network requests.`);
  console.log(`Market dates: ${charts.overviewChart.length}; gas samples: ${charts.gasChart.length}; complete transaction samples: ${charts.blockTxChart.length}.`);
} catch (error) {
  console.error(`Replay failed: ${error?.message ?? 'unexpected error'}`);
  process.exitCode = 1;
}
