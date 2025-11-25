import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chokidar from 'chokidar';
import * as sass from 'sass';

interface SassEntry {
  input: string;
  outputs: string[];
}

interface SassConfig {
  entries: SassEntry[];
  watchGlobs: string[];
  sassOptions: sass.Options<'async'>;
}

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

const config: SassConfig = {
  entries: [
    {
      input: 'src/styles/stylesheet-light.scss',
      outputs: ['dist/stylesheet.css', 'dist/stylesheet-light.css'],
    },
    {
      input: 'src/styles/stylesheet-dark.scss',
      outputs: ['dist/stylesheet-dark.css'],
    },
  ],
  watchGlobs: ['src/styles/**/*.scss'],
  sassOptions: {
    style: 'expanded',
    sourceMap: false,
    loadPaths: ['src/styles'],
  },
};

export default config;

async function compileEntry(entry: SassEntry): Promise<void> {
  const inputPath = resolve(projectRoot, entry.input);
  const result = await sass.compileAsync(inputPath, config.sassOptions);

  await Promise.all(entry.outputs.map(async (output) => {
    const outputPath = resolve(projectRoot, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.css, 'utf8');
    console.log(`✓ ${entry.input} → ${output}`);
  }));
}

export async function buildAll(): Promise<void> {
  for (const entry of config.entries) {
    await compileEntry(entry);
  }
  console.log('Sass build complete.');
}

export async function watchAll(): Promise<void> {
  await buildAll();

  let isBuilding = false;
  let needsRebuild = false;

  const enqueueBuild = async (): Promise<void> => {
    if (isBuilding) {
      needsRebuild = true;
      return;
    }
    isBuilding = true;
    do {
      needsRebuild = false;
      try {
        await buildAll();
      } catch (error) {
        console.error('Sass build failed:', error);
      }
    } while (needsRebuild);
    isBuilding = false;
  };

  const watcher = chokidar.watch(config.watchGlobs, {
    ignoreInitial: true,
  });

  watcher.on('all', (event, changedPath) => {
    console.log(`[watch] ${event}: ${changedPath}`);
    void enqueueBuild();
  });

  console.log('Watching Sass files... (press Ctrl+C to stop)');
}

async function run(): Promise<void> {
  const watchMode = process.argv.includes('--watch');
  if (watchMode) {
    await watchAll();
  } else {
    await buildAll();
  }
}

const invokedFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedFile === import.meta.url) {
  void run();
}
