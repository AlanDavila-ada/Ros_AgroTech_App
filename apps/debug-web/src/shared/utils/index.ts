export function classNames(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(" ");
}
