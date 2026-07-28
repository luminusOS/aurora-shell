import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const UUID = 'aurora-shell@luminusos.github.io';
const productionPath = resolve('dist/target', `${UUID}.shell-extension.zip`);
const developmentPath = resolve('dist/target', `${UUID}.development.shell-extension.zip`);

function inspectPackage(path: string, development: boolean): void {
  const zip = new AdmZip(path);
  const entries = zip.getEntries();
  const names = new Set(entries.map((entry) => entry.entryName));
  const label = development ? 'development' : 'production';

  for (const required of ['extension.js', 'metadata.json', 'LICENSE', 'CREDITS.md']) {
    if (!names.has(required)) throw new Error(`${label} package is missing ${required}`);
  }

  const extension = zip.readAsText('extension.js');
  const stylesheet = zip.readAsText('stylesheet.css');
  if (development) {
    if (!names.has('dev/devTool.js'))
      throw new Error('development package is missing dev/devTool.js');
    if (!extension.includes('DevTool'))
      throw new Error('development entry point does not enable DevTool');
    if (!stylesheet.includes('.aurora-devtool'))
      throw new Error('development package is missing DevTool styles');
  } else {
    const forbidden = [...names].filter(
      (name) => name === 'extension.dev.js' || name.startsWith('dev/'),
    );
    if (forbidden.length > 0)
      throw new Error(`production package contains developer files: ${forbidden.join(', ')}`);
    if (extension.includes('DevTool') || extension.includes('AURORA_DEVTOOLS'))
      throw new Error('production entry point references developer tooling');
    if (stylesheet.includes('.aurora-devtool'))
      throw new Error('production stylesheet contains developer-only styles');
  }

  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.endsWith('.js')) continue;
    const lines = entry.getData().toString('utf8').split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (line.length > 200)
        throw new Error(
          `${label} package ${entry.entryName}:${index + 1} has ${line.length} characters`,
        );
    }
  }

  console.log(`${label} package policy: PASS (${entries.length} entries)`);
}

for (const path of [productionPath, developmentPath]) {
  try {
    readFileSync(path);
  } catch {
    throw new Error(`package not found: ${basename(path)}`);
  }
}

inspectPackage(productionPath, false);
inspectPackage(developmentPath, true);
