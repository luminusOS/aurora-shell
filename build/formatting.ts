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
export function addBlankLinesBetweenMembers(code: string): string {
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

      // Between last import and first non-import declaration
      if (
        !needsBlank &&
        prevIndent === 0 &&
        prevTrimmed.startsWith('import ') &&
        !currTrimmed.startsWith('import ')
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
