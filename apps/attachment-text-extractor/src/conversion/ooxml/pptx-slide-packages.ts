import type { Document, Element } from '@xmldom/xmldom';

import type { ConversionLimits } from '../../contract';
import { ConversionError } from '../conversion-error';
import type { OoxmlArchive } from './archive-guard';
import { childElements, firstChildElement } from './dom-elements';
import { type ContentTypes, indexContentTypes } from './pptx-content-types';
import { PartStore } from './pptx-part-store';
import {
  CONTENT_TYPES,
  isSlide,
  type Relationship,
  relationshipIdOf,
  relationshipsDocument,
  relationshipsPartOf,
  serializeRelationship,
} from './pptx-relationships';
import { parseXmlPart, serializeXmlPart } from './safe-xml';
import { type PackagePart, writeStoredZip } from './zip-writer';

export const PRESENTATION = 'ppt/presentation.xml';
const ROOT_RELATIONSHIPS = '_rels/.rels';

/** What every slide's package is built from, read once per deck. */
interface Deck {
  readonly store: PartStore;
  readonly presentation: Document;
  readonly slideList: Element | undefined;
  readonly slideEntries: readonly Element[];
  readonly relationships: readonly Relationship[];
  readonly slideParts: ReadonlySet<string>;
  readonly contentTypes: ContentTypes;
}

/** The slide list, emptied once: each package puts back only its own entry. */
const takeSlideEntries = (
  presentation: Document,
  maxEntries: number,
): { list: Element | undefined; entries: Element[] } => {
  const list = firstChildElement(presentation.documentElement, 'sldIdLst');
  const entries = childElements(list, 'sldId');
  if (entries.length > maxEntries) {
    throw new ConversionError(
      'limit_exceeded',
      'slide list is longer than the archive entry limit',
    );
  }
  for (const entry of entries) {
    list?.removeChild(entry);
  }
  return { list, entries };
};

const partsOf = (relationships: readonly Relationship[]): string[] =>
  relationships.flatMap(({ part }) => (part == null ? [] : [part]));

const openDeck = async (
  archive: OoxmlArchive,
  limits: ConversionLimits,
): Promise<Deck> => {
  const store = new PartStore(archive, limits.maxArchiveUncompressedBytes);
  const presentation = parseXmlPart(
    await store.read(PRESENTATION),
    'PPTX part',
  );
  const slides = takeSlideEntries(presentation, limits.maxArchiveEntries);
  const relationships = await store.relationships(PRESENTATION);
  const slideParts = new Set(partsOf(relationships.filter(isSlide)));
  const sharedRoots = [
    ...partsOf(await store.relationships('')).filter((p) => p !== PRESENTATION),
    ...partsOf(relationships.filter((rel) => !isSlide(rel))),
  ];
  await store.share(
    await store.closure(
      sharedRoots,
      (part) => part === PRESENTATION || slideParts.has(part),
    ),
  );
  const contentTypes = indexContentTypes(
    parseXmlPart(await store.read(CONTENT_TYPES), 'PPTX part'),
  );
  return {
    store,
    presentation,
    slideList: slides.list,
    slideEntries: slides.entries,
    relationships,
    slideParts,
    contentTypes,
  };
};

/**
 * presentation.xml.rels for one slide: every relationship that is not a
 * slide, plus this slide's, in document order. Built from strings made once,
 * so a deck of many slides does not cost the square of its slide count.
 */
const keptRelationships = (deck: Deck): ((slide: Relationship) => Buffer) => {
  const xml = deck.relationships.map(serializeRelationship);
  const indexOf = new Map(deck.relationships.map((rel, i) => [rel, i]));
  const others = deck.relationships.flatMap((rel, i) =>
    isSlide(rel) ? [] : [i],
  );
  return (slide) => {
    const own = indexOf.get(slide) ?? -1;
    const before = others.filter((i) => i < own).map((i) => xml[i]);
    const after = others.filter((i) => i > own).map((i) => xml[i]);
    return relationshipsDocument([...before, xml[own], ...after]);
  };
};

const presentationWithOnly = (deck: Deck, entry: Element): Buffer => {
  deck.slideList?.appendChild(entry);
  try {
    return serializeXmlPart(deck.presentation);
  } finally {
    deck.slideList?.removeChild(entry);
  }
};

const packageParts = async (
  deck: Deck,
  slide: string,
): Promise<Map<string, Buffer>> => {
  const { store } = deck;
  // Other slides stay out even when hyperlinked, or every package would grow with the deck.
  const own = await store.closure(
    [slide],
    (part) =>
      part === PRESENTATION ||
      store.shared.has(part) ||
      (part !== slide && deck.slideParts.has(part)),
  );
  const parts = new Map(store.shared);
  for (const part of own) {
    // biome-ignore lint/performance/noAwaitInLoops: one budget is charged in read order
    parts.set(part, await store.read(part));
  }
  return parts;
};

const slidePackage = async (
  deck: Deck,
  entry: Element,
  presentationRelationships: Buffer,
  slide: string,
): Promise<Buffer> => {
  const parts = await packageParts(deck, slide);
  const rootRelationships = deck.store.rawRelationshipsOf('');
  const zipParts: PackagePart[] = [
    {
      name: CONTENT_TYPES,
      body: deck.contentTypes.forParts([PRESENTATION, ...parts.keys()]),
    },
    ...(rootRelationships === undefined
      ? []
      : [{ name: ROOT_RELATIONSHIPS, body: rootRelationships }]),
    { name: PRESENTATION, body: presentationWithOnly(deck, entry) },
    {
      name: relationshipsPartOf(PRESENTATION),
      body: presentationRelationships,
    },
  ];
  for (const [name, body] of parts) {
    zipParts.push({ name, body });
    const raw = deck.store.rawRelationshipsOf(name);
    if (raw !== undefined) {
      zipParts.push({ name: relationshipsPartOf(name), body: raw });
    }
  }
  return writeStoredZip(zipParts);
};

/**
 * One package per slide list entry, in presentation order: the deck reduced
 * to that slide plus the XML parts it reaches. Built lazily, so only one is
 * held at a time.
 */
export async function* slidePackages(
  archive: OoxmlArchive,
  limits: ConversionLimits,
): AsyncGenerator<Buffer> {
  const deck = await openDeck(archive, limits);
  const byId = new Map(deck.relationships.map((rel) => [rel.id, rel]));
  const relationshipsFor = keptRelationships(deck);
  for (const entry of deck.slideEntries) {
    const rel = byId.get(relationshipIdOf(entry) || '');
    if (rel?.part == null || !isSlide(rel)) {
      throw new ConversionError(
        'malformed',
        'slide list entry does not point at a slide part',
      );
    }
    yield slidePackage(deck, entry, relationshipsFor(rel), rel.part);
  }
}
