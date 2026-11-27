import { ConversionError } from '../conversion-error';
import type { OoxmlArchive } from './archive-guard';
import {
  parseRelationships,
  type Relationship,
  relationshipsPartOf,
} from './pptx-relationships';

/**
 * The parts of one deck as the splitter reads them: every read is charged to
 * one budget of inflated bytes (so re-reading a huge slide per list entry
 * still stops), parts shared by all slides are read once, and each part's
 * relationships are parsed once. Part "" stands for the package root.
 */
export class PartStore {
  readonly #archive: OoxmlArchive;
  readonly #names: ReadonlySet<string>;
  readonly #relationships = new Map<string, readonly Relationship[]>();
  readonly #rawRelationships = new Map<string, Buffer>();
  readonly #shared = new Map<string, Buffer>();
  #budget: number;

  constructor(archive: OoxmlArchive, budget: number) {
    this.#archive = archive;
    this.#names = new Set(archive.entries.map((entry) => entry.name));
    this.#budget = budget;
  }

  get shared(): ReadonlyMap<string, Buffer> {
    return this.#shared;
  }

  async read(name: string): Promise<Buffer> {
    const shared = this.#shared.get(name);
    if (shared !== undefined) {
      return shared;
    }
    if (this.#budget <= 0) {
      throw new ConversionError(
        'limit_exceeded',
        'archive parts expand beyond the size limit',
      );
    }
    const body = await this.#archive.readPart(name, this.#budget);
    this.#budget -= body.length;
    return body;
  }

  async share(parts: readonly string[]): Promise<void> {
    for (const part of parts) {
      // biome-ignore lint/performance/noAwaitInLoops: one budget is charged in read order
      this.#shared.set(part, await this.read(part));
    }
  }

  /** The part's .rels bytes as stored, when it has one. */
  rawRelationshipsOf(part: string): Buffer | undefined {
    return this.#rawRelationships.get(part);
  }

  async relationships(part: string): Promise<readonly Relationship[]> {
    const known = this.#relationships.get(part);
    if (known !== undefined) {
      return known;
    }
    const relsName = relationshipsPartOf(part);
    let parsed: readonly Relationship[] = [];
    if (this.#names.has(relsName)) {
      const raw = await this.read(relsName);
      this.#rawRelationships.set(part, raw);
      parsed = parseRelationships(raw, this.#names, part);
    }
    this.#relationships.set(part, parsed);
    return parsed;
  }

  /** XML parts reachable from the roots through relationships, never entering an excluded part. */
  async closure(
    roots: readonly string[],
    isExcluded: (part: string) => boolean,
  ): Promise<string[]> {
    const seen = new Set<string>();
    const pending = roots.filter((part) => !isExcluded(part));
    for (let part = pending.pop(); part !== undefined; part = pending.pop()) {
      if (seen.has(part)) {
        continue;
      }
      seen.add(part);
      for (const { part: next } of await this.relationships(part)) {
        if (next != null && !isExcluded(next) && !seen.has(next)) {
          pending.push(next);
        }
      }
    }
    return [...seen];
  }
}
