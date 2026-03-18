/**
 * Argument parser that supports quoted strings.
 */
export function parseArgs(input: string): string[] {
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  const args: string[] = [];
  let match;

  while ((match = regex.exec(input)) !== null) {
      // match[1] is double quotes content, match[2] is single, match[0] is unquoted
      args.push(match[1] || match[2] || (match[0] as string));
  }

  return args;
}
