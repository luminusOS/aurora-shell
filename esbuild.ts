import type { Plugin } from 'esbuild';
import { build } from 'esbuild';
import {
  copyFileSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { format } from 'prettier';

interface ExtensionMetadata {
  name: string;
  version: string;
  uuid: string;
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const metadataPath = resolve(currentDir, 'metadata.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as ExtensionMetadata;

// Externalize local .ts imports and rewrite paths to .js
const localExternals: Plugin = {
  name: 'local-externals',
  setup(ctx) {
    ctx.onResolve({ filter: /\.ts$/ }, (args) => {
      if (args.kind === 'entry-point') return;
      if (args.path.startsWith('.')) {
        return {
          path: args.path.replace(/\.ts$/, '.js'),
          external: true,
        };
      }
    });
  },
};

// Resolve @girs/* imports directly to gi:// and resource:// runtime paths,
// bypassing node_modules to avoid re-export shims and version query strings
const girsResolver: Plugin = {
  name: 'girs-resolver',
  setup(ctx) {
    // @girs/gjs is a type-only shim; drop it entirely
    ctx.onResolve({ filter: /^@girs\/gjs$/ }, () => ({
      path: 'gjs',
      namespace: 'girs-empty',
    }));
    ctx.onLoad({ filter: /.*/, namespace: 'girs-empty' }, () => ({
      contents: '',
      loader: 'js',
    }));

    // @girs/gnome-shell/* → resource:///org/gnome/shell/*.js
    ctx.onResolve({ filter: /^@girs\/gnome-shell\// }, (args) => {
      const subpath = args.path.replace('@girs/gnome-shell/', '');
      const distFile = resolve(
        currentDir,
        'node_modules/@girs/gnome-shell/dist',
        `${subpath}.js`,
      );
      // Read the actual resource path from the package when the file exists,
      // otherwise fall back to the standard resource path pattern
      if (existsSync(distFile)) {
        const content = readFileSync(distFile, 'utf8');
        const match = content.match(/from ['"](.+)['"]/);
        if (match) return { path: match[1], external: true };
      }
      return {
        path: `resource:///org/gnome/shell/${subpath}.js`,
        external: true,
      };
    });

    // @girs/<name>-<version> → gi://<Namespace> (without ?version=)
    ctx.onResolve({ filter: /^@girs\// }, (args) => {
      if (args.path === '@girs/gjs' || args.path.startsWith('@girs/gnome-shell/'))
        return;
      const pkgName = args.path.replace('@girs/', '');
      const mainFile = resolve(
        currentDir,
        `node_modules/@girs/${pkgName}/${pkgName}.js`,
      );
      if (existsSync(mainFile)) {
        const content = readFileSync(mainFile, 'utf8');
        const match = content.match(/from ["'](gi:\/\/[^?"']+)/);
        if (match) return { path: match[1], external: true };
      }
    });
  },
};

// JS keywords that should NOT be treated as method declarations
const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'throw', 'try', 'catch',
  'finally', 'else', 'do', 'new', 'typeof', 'void', 'delete', 'await',
  'yield', 'debugger', 'with', 'break', 'continue', 'case', 'default',
  'super', 'this', 'true', 'false', 'null', 'undefined',
]);

// Add blank lines between class methods, between the last field and first
// method, and between top-level declarations. esbuild strips these blank
// lines during compilation and prettier does not re-add them.
function addBlankLinesBetweenMembers(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];

  const isMethodDecl = (trimmed: string): boolean => {
    const m = trimmed.match(
      /^(?:(?:get |set |static |async )*([a-zA-Z_$#]\w*)\s*\()/,
    );
    return m !== null && !JS_KEYWORDS.has(m[1]);
  };

  const isComment = (trimmed: string): boolean =>
    trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');

  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && lines[i].trim() !== '' && lines[i - 1].trim() !== '') {
      const prev = lines[i - 1];
      const curr = lines[i];
      const prevTrimmed = prev.trimStart();
      const currTrimmed = curr.trimStart();
      const prevIndent = prev.search(/\S|$/);
      const currIndent = curr.search(/\S|$/);
      let needsBlank = false;

      const isClosingBrace = /^\};?$/.test(prevTrimmed);

      // Between methods: closing } at indent N → method decl at indent N
      if (
        isClosingBrace &&
        currIndent === prevIndent &&
        (isMethodDecl(currTrimmed) || isComment(currTrimmed))
      ) {
        needsBlank = true;
      }

      // Between last field and first method at the same indent level
      if (
        !needsBlank &&
        /;$/.test(prevTrimmed) &&
        /^[a-zA-Z_$#]\w*/.test(prevTrimmed) &&
        currIndent === prevIndent &&
        isMethodDecl(currTrimmed)
      ) {
        needsBlank = true;
      }

      // Between top-level declarations (indent 0) after block closures
      if (
        !needsBlank &&
        currIndent === 0 &&
        /[})\]];?\s*$/.test(prevTrimmed) &&
        /^(?:var |let |const |function |class |export )/.test(currTrimmed)
      ) {
        needsBlank = true;
      }

      if (needsBlank) {
        result.push('');
      }
    }

    result.push(lines[i]);
  }

  return result.join('\n');
}

const srcDir = resolve(currentDir, 'src');
const entryPoints = (readdirSync(srcDir, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
  .map((file) => join('src', file));

console.debug(`Building ${metadata.name} v${metadata.version}...`);

const sharedOptions = {
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  plugins: [localExternals, girsResolver],
  // Do not remove the functions `enable()`, `disable()` and `init()`
  treeShaking: false,
  // firefox60  // Since GJS 1.53.90
  // firefox68  // Since GJS 1.63.90
  // firefox78  // Since GJS 1.65.90
  // firefox91  // Since GJS 1.71.1
  // firefox102 // Since GJS 1.73.2
  target: 'firefox102' as const,
  format: 'esm' as const,
  external: ['gi://*', 'resource://*', 'system', 'gettext', 'cairo'],
};

Promise.all(
  entryPoints.map((entryPoint) =>
    build({ ...sharedOptions, entryPoints: [entryPoint] }),
  ),
)
  .then(async () => {
    const distDir = resolve(currentDir, 'dist');
    const metaDist = resolve(distDir, 'metadata.json');
    const schemasSrc = resolve(currentDir, 'schemas');
    const styleFiles = [
      'stylesheet.css',
      'stylesheet-light.css',
      'stylesheet-dark.css',
    ];
    const zipFilename = `${metadata.uuid}.zip`;
    const zipDist = resolve(distDir, zipFilename);

    // Format output files with prettier
    const jsFiles = (readdirSync(distDir, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.js'));

    for (const file of jsFiles) {
      const filePath = resolve(distDir, file);
      const content = readFileSync(filePath, 'utf8');
      const formatted = await format(content, { parser: 'babel', filepath: filePath });
      writeFileSync(filePath, addBlankLinesBetweenMembers(formatted));
    }

    copyFileSync(metadataPath, metaDist);

    const zip: AdmZip = new AdmZip();

    for (const file of jsFiles) {
      const filePath = resolve(distDir, file);
      const dir = dirname(file);
      zip.addLocalFile(filePath, dir === '.' ? '' : dir);
    }

    styleFiles.forEach((styleFile) => {
      const stylePath = resolve(distDir, styleFile);
      if (existsSync(stylePath)) {
        zip.addLocalFile(stylePath);
      }
    });
    zip.addLocalFile(metaDist);
    if (existsSync(schemasSrc)) {
      zip.addLocalFolder(schemasSrc, 'schemas');
    }
    zip.writeZip(zipDist);

    console.debug(`Build complete. Zip file: ${zipFilename}`);
  })
  .catch((error: unknown) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
