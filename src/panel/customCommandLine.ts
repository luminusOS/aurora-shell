import GLib from 'gi://GLib';

export function parseCustomCommandLine(raw: string) {
  try {
    const [ok, words] = GLib.shell_parse_argv(raw);
    if (!ok || !words) return null;
    const environment = new Map<string, string>();
    for (const [index, word] of words.entries()) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word);
      if (!assignment) {
        if (!word) return null;
        return { argv: words.slice(index), environment };
      }
      const [, name, value] = assignment;
      if (name && value !== undefined)
        environment.set(
          name,
          value.replace(/^\$HOME(?=\/|$)/, () => GLib.get_home_dir()),
        );
    }
  } catch {
    // GLib rejects incomplete quoting while the command is being edited.
  }
  return null;
}
