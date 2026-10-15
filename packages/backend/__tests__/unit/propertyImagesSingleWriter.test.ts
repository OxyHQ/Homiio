/**
 * `property_images` has ONE writer: `replacePropertyImages` in
 * `db/properties/propertyWrites.ts`, which re-derives `properties.has_images`
 * in the same transaction. Nothing re-derives the flag on a schedule any more,
 * so a second writer would be a drift nobody repairs. This gate keeps the
 * write in one file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const BACKEND_ROOT = join(__dirname, '..', '..');
const THE_WRITER = join('db', 'properties', 'propertyWrites.ts');

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['__tests__', 'dist', 'node_modules', 'drizzle'].includes(entry.name)
        ? []
        : runtimeSources(path);
    }
    return /\.(?:c|m)?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

const WRITE_PATTERNS = [
  /\.(?:insert|update|delete)\(\s*propertyImages\s*\)/,
  /\b(?:insert\s+into|update|delete\s+from)\s+"?property_images"?\b/i,
] as const;

function writesPropertyImages(source: string): boolean {
  return WRITE_PATTERNS.some((pattern) => pattern.test(source));
}

describe('property_images has one writer', () => {
  it('is written only by db/properties/propertyWrites.ts', () => {
    const writers = runtimeSources(BACKEND_ROOT)
      .filter((file) => writesPropertyImages(readFileSync(file, 'utf8')))
      .map((file) => relative(BACKEND_ROOT, file));
    expect(writers).toEqual([THE_WRITER]);
  });

  it.each([
    'await db.insert(propertyImages).values(rows)',
    'await tx.delete( propertyImages ).where(x)',
    'db.update(propertyImages).set({ propertyId })',
    'sql`insert into property_images (id) values (1)`',
    'sql`delete from "property_images" where true`',
    'sql`update property_images set property_id = 1`',
  ])('catches %s', (source) => {
    expect(writesPropertyImages(source)).toBe(true);
  });
});
