import { describe, expect, it } from 'vitest';
import { BUILTIN_SOURCES, BUILTIN_SOURCE_SEED_VERSION } from './builtin-sources';

describe('built-in OPML source seed', () => {
  it('contains every unique source from the supplied OPML', () => {
    expect(BUILTIN_SOURCE_SEED_VERSION).toBe(1);
    expect(BUILTIN_SOURCES).toHaveLength(92);
    expect(new Set(BUILTIN_SOURCES.map((source) => source.url)).size).toBe(92);
  });

  it('enables only sources safe for the native HTTPS fetcher', () => {
    expect(BUILTIN_SOURCES.filter((source) => source.enabled)).toHaveLength(90);
    expect(BUILTIN_SOURCES.filter((source) => !source.enabled).map((source) => source.title)).toEqual(['antirez.com', 'paulgraham.com']);
  });
});
