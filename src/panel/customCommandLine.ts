import GLib from 'gi://GLib';

export function parseCommandWords(raw: string): string[] | null {
  try {
    const [ok, words] = GLib.shell_parse_argv(raw);
    if (ok && words?.[0]) return words;
  } catch {
    // GLib rejects incomplete quoting while the command is being edited.
  }
  return null;
}

export function parseCustomCommandLine(raw: string) {
  const words = parseCommandWords(raw);
  if (!words) return null;

  const environment = new Map<string, string>();
  for (const [index, word] of words.entries()) {
    if (!word) return null;

    const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/.exec(word);
    if (!assignment) return { argv: words.slice(index), environment };

    const prefix = assignment[0];
    const value = word.slice(prefix.length);
    environment.set(
      prefix.slice(0, -1),
      value.replace(/^\$HOME(?=\/|$)/, () => GLib.get_home_dir()),
    );
  }

  return null;
}
