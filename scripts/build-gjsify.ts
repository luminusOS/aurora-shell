import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(projectRoot, 'src');
const outDir = resolve(projectRoot, 'dist-gjsify');
const shouldPackage = process.argv.includes('--package');

const sassEntries = [
  {
    input: 'src/styles/stylesheet-light.scss',
    outputs: ['stylesheet.css', 'stylesheet-light.css'],
  },
  {
    input: 'src/styles/stylesheet-dark.scss',
    outputs: ['stylesheet-dark.css'],
  },
];

function run(command: string, args: string[], cwd = projectRoot): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

async function listTypeScriptEntries(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptEntries(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(relative(projectRoot, path));
    }
  }

  return files.sort();
}

async function buildJavaScript(): Promise<void> {
  const entryPoints = await listTypeScriptEntries(srcDir);

  console.log(`gjsify: building ${entryPoints.length} TypeScript modules -> dist-gjsify/`);
  run('yarn', [
    'gjsify',
    'build',
    ...entryPoints,
    '--library',
    '--outdir',
    outDir,
    '--format',
    'esm',
    '--no-minify',
    '--log-level',
    'warning',
  ]);

  await postprocessJavaScript(outDir);
  await rm(resolve(outDir, '_virtual'), { recursive: true, force: true });
}

async function postprocessJavaScript(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      await postprocessJavaScript(path);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    const original = await readFile(path, 'utf8');
    const rewritten = rewriteImports(original, path);

    if (rewritten !== original) {
      await writeFile(path, rewritten, 'utf8');
    }
  }
}

function rewriteImports(source: string, filePath: string): string {
  return rewriteGObjectDecorators(source)
    .replace(/^import\s+['"]@girs\/gjs['"];?\n?/gm, '')
    .replace(/(['"])~\/([^'"]+?)\.ts\1/g, (_match, quote: string, importPath: string) => {
      return `${quote}${relativeImport(filePath, resolve(outDir, `${importPath}.js`))}${quote}`;
    })
    .replace(/(['"])@girs\/gnome-shell\/([^'"]+)\1/g, (_match, quote: string, subpath: string) => {
      return `${quote}${resolveGnomeShellResource(subpath)}${quote}`;
    })
    .replace(/(['"])@girs\/([^'"]+)\1/g, (_match, quote: string, packageName: string) => {
      return `${quote}${resolveGiImport(packageName)}${quote}`;
    });
}

function rewriteGObjectDecorators(source: string): string {
  let result = source.replace(
    /^import\s+\{\s*__decorate\s*\}\s+from\s+['"][^'"]+decorate\.js['"];?\n?/gm,
    '',
  );

  let searchFrom = 0;

  while (true) {
    const decorateIndex = result.indexOf('__decorate([GObject.registerClass', searchFrom);
    if (decorateIndex === -1) break;

    const assignmentStart = findAssignmentStart(result, decorateIndex);
    const assignmentEnd = result.indexOf(';', decorateIndex);
    if (assignmentStart === -1 || assignmentEnd === -1) {
      searchFrom = decorateIndex + 1;
      continue;
    }

    const assignment = result.slice(assignmentStart, assignmentEnd + 1);
    const targetMatch = assignment.match(
      /^([A-Za-z_$][\w$]*)\s*=\s*(?:_[A-Za-z_$][\w$]*\s*=\s*)?__decorate/,
    );
    if (!targetMatch) {
      searchFrom = assignmentEnd + 1;
      continue;
    }

    const className = targetMatch[1];
    const classDeclStart = result.lastIndexOf(`let ${className} =`, assignmentStart);
    if (classDeclStart === -1) {
      searchFrom = assignmentEnd + 1;
      continue;
    }

    const classKeyword = result.indexOf('class ', classDeclStart);
    if (classKeyword === -1) {
      searchFrom = assignmentEnd + 1;
      continue;
    }

    const classBodyStart = result.indexOf('{', classKeyword);
    if (classBodyStart === -1) {
      searchFrom = assignmentEnd + 1;
      continue;
    }

    const classBodyEnd = findMatchingClose(result, classBodyStart);
    if (classBodyEnd === -1) {
      searchFrom = assignmentEnd + 1;
      continue;
    }

    const classDecl = result.slice(classKeyword, classBodyEnd);
    const hasPrivateAlias = result.slice(classDeclStart, classKeyword).includes(`_${className} =`);
    const metadata = extractRegisterClassMetadata(result, decorateIndex);
    const registerArgs = metadata ? `${metadata}, ${classDecl}` : classDecl;
    const lhs = hasPrivateAlias ? `${className} = _${className}` : className;
    const replacement = `const ${lhs} = GObject.registerClass(${registerArgs});`;

    result = result.slice(0, classDeclStart) + replacement + result.slice(assignmentEnd + 1);
    searchFrom = classDeclStart + replacement.length;
  }

  return result;
}

function findAssignmentStart(source: string, decorateIndex: number): number {
  const lineStart = source.lastIndexOf('\n', decorateIndex) + 1;
  return lineStart;
}

function extractRegisterClassMetadata(source: string, decorateIndex: number): string {
  const callStart = source.indexOf('GObject.registerClass', decorateIndex);
  const metadataStart = callStart + 'GObject.registerClass'.length;

  if (source[metadataStart] !== '(') return '';

  const metadataEnd = findMatchingClose(source, metadataStart);
  return source.slice(metadataStart + 1, metadataEnd - 1).trim();
}

function findMatchingClose(source: string, start: number): number {
  const open = source[start];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 1;
  let pos = start + 1;

  while (pos < source.length && depth > 0) {
    const ch = source[pos];

    if (ch === '"' || ch === "'" || ch === '`') {
      pos++;
      while (pos < source.length && source[pos] !== ch) {
        if (source[pos] === '\\') pos++;
        pos++;
      }
      pos++;
      continue;
    }

    if (ch === '/' && source[pos + 1] === '/') {
      pos = source.indexOf('\n', pos);
      if (pos === -1) return source.length;
      pos++;
      continue;
    }

    if (ch === '/' && source[pos + 1] === '*') {
      pos = source.indexOf('*/', pos + 2);
      if (pos === -1) return source.length;
      pos += 2;
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) depth--;
    pos++;
  }

  return pos;
}

function relativeImport(fromFile: string, toFile: string): string {
  let path = relative(dirname(fromFile), toFile).replaceAll('\\', '/');
  if (!path.startsWith('.')) path = `./${path}`;
  return path;
}

function resolveGnomeShellResource(subpath: string): string {
  const distFile = resolve(projectRoot, 'node_modules/@girs/gnome-shell/dist', `${subpath}.js`);

  try {
    const content = readFileSync(distFile, 'utf8');
    const match = content.match(/from ['"](.+)['"]/);
    if (match) return match[1];
  } catch {
    // Fall through to the normal GNOME Shell resource path.
  }

  return `resource:///org/gnome/shell/${subpath}.js`;
}

function resolveGiImport(packageName: string): string {
  const namespace = GI_NAMESPACES[packageName];
  if (namespace) return `gi://${namespace}`;

  throw new Error(`No GJSify import mapping for @girs/${packageName}`);
}

const GI_NAMESPACES: Record<string, string> = {
  'adw-1': 'Adw',
  'clutter-18': 'Clutter',
  'gdk-4.0': 'Gdk',
  'gdkpixbuf-2.0': 'GdkPixbuf',
  'gio-2.0': 'Gio',
  'giounix-2.0': 'GioUnix',
  'glib-2.0': 'GLib',
  'gobject-2.0': 'GObject',
  'gtk-4.0': 'Gtk',
  'meta-18': 'Meta',
  'mtk-18': 'Mtk',
  'shell-18': 'Shell',
  'st-18': 'St',
};

async function buildCss(): Promise<void> {
  for (const entry of sassEntries) {
    const result = await sass.compileAsync(resolve(projectRoot, entry.input), {
      style: 'expanded',
      sourceMap: false,
      loadPaths: [resolve(projectRoot, 'src/styles')],
    });

    for (const output of entry.outputs) {
      await writeFile(resolve(outDir, output), result.css, 'utf8');
      console.log(`sass: ${entry.input} -> dist-gjsify/${output}`);
    }
  }
}

async function copyResources(): Promise<void> {
  await copyFile(resolve(projectRoot, 'metadata.json'), resolve(outDir, 'metadata.json'));
  await cp(resolve(projectRoot, 'data/schemas'), resolve(outDir, 'schemas'), {
    recursive: true,
  });
  await cp(resolve(projectRoot, 'data/icons'), resolve(outDir, 'icons'), {
    recursive: true,
  });
  await cp(resolve(projectRoot, 'data/media'), resolve(outDir, 'media'), {
    recursive: true,
  });

  run('glib-compile-schemas', [resolve(outDir, 'schemas')]);
}

async function compileTranslations(): Promise<void> {
  const domain = 'aurora-shell@luminusos.github.io';
  const poDir = resolve(projectRoot, 'data/po');
  const files = await readdir(poDir);

  for (const file of files.filter((name) => name.endsWith('.po'))) {
    const lang = file.replace(/\.po$/, '');
    const outputDir = resolve(outDir, 'locale', lang, 'LC_MESSAGES');
    await mkdir(outputDir, { recursive: true });
    run('msgfmt', ['--output-file', resolve(outputDir, `${domain}.mo`), resolve(poDir, file)]);
    console.log(`msgfmt: data/po/${file} -> dist-gjsify/locale/${lang}/LC_MESSAGES/${domain}.mo`);
  }
}

async function packageExtension(): Promise<void> {
  const uuid = 'aurora-shell@luminusos.github.io';
  await mkdir(resolve(outDir, 'target'), { recursive: true });

  const rootFiles = await readdir(outDir);
  const extraSources: string[] = [];

  for (const file of rootFiles) {
    if (file === 'extension.js' || file === 'schemas' || file === 'target') continue;

    const fileStat = await stat(resolve(outDir, file));
    if (fileStat.isDirectory() || file.endsWith('.css') || file.endsWith('.js')) {
      extraSources.push(`--extra-source=${file}`);
    }
  }

  run(
    'gnome-extensions',
    [
      'pack',
      '.',
      '--force',
      '--out-dir=target',
      ...extraSources,
      '--schema=schemas/org.gnome.shell.extensions.aurora-shell.gschema.xml',
    ],
    outDir,
  );

  console.log(`Packed dist-gjsify/target/${uuid}.shell-extension.zip`);
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await buildCss();
  await buildJavaScript();
  await copyResources();
  await compileTranslations();

  if (shouldPackage) {
    await packageExtension();
  }

  console.log('GJSify experimental build complete.');
}

void main().catch((error: unknown) => {
  console.error('GJSify experimental build failed:', error);
  process.exit(1);
});
