import type { Plugin } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve @girs/* imports directly to gi:// and resource:// runtime paths,
// bypassing node_modules to avoid re-export shims and version query strings
export function createGirsResolver(rootDir: string): Plugin {
  return {
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
          rootDir,
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
          rootDir,
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
}
