// Turn an app name into a URL-safe slug, e.g. "Age Verification" → "age-verification".
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
