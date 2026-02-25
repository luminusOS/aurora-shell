import { build } from 'esbuild';
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

import { localExternals } from './build/plugins/local-externals.ts';
import { createGirsResolver } from './build/plugins/girs-resolver.ts';
import { gobjectDecorator } from './build/plugins/gobject-decorator.ts';
import { addBlankLinesBetweenMembers } from './build/formatting.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

const srcDir = resolve(currentDir, 'src');
const entryPoints = (readdirSync(srcDir, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => join('src', file));

console.debug('Building extension...');

try {
  await build({
    entryPoints,
    outdir: 'dist',
    outbase: 'src',
    bundle: true,
    plugins: [gobjectDecorator, localExternals, createGirsResolver(currentDir)],
    treeShaking: false,
    target: 'firefox102',
    format: 'esm',
    external: ['gi://*', 'resource://*', 'system', 'gettext', 'cairo'],
  });

  const distDir = resolve(currentDir, 'dist');
  const jsFiles = (readdirSync(distDir, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.js'));

  console.debug('Formatting output files...');
  
  for (const file of jsFiles) {
    const filePath = resolve(distDir, file);
    const content = readFileSync(filePath, 'utf8');
    
    const prettierConfig = await resolveConfig(filePath) || {};
    
    const formatted = await format(content, { 
      ...prettierConfig, 
      parser: 'babel', 
      filepath: filePath 
    });

    writeFileSync(filePath, addBlankLinesBetweenMembers(formatted));
  }

  copyFileSync(resolve(currentDir, 'metadata.json'), resolve(distDir, 'metadata.json'));

  console.debug('Build complete.');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}