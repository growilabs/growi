import type { Data, Parent, PhrasingContent } from 'mdast';

import { DirectiveType as DirectiveTypeObject } from './lib/index.js';

export { directiveFromMarkdown, directiveToMarkdown } from './lib/index.js';
export { DirectiveTypeObject };

type DirectiveType = typeof DirectiveTypeObject;

/**
 * Fields shared by directives.
 */
interface DirectiveFields {
  /**
   * Directive name.
   */
  name: string;

  /**
   * Directive attributes.
   */
  attributes?: Record<string, string | null | undefined> | null | undefined;
}

/**
 * Markdown directive (leaf form).
 */
export interface LeafGrowiPluginDirective extends Parent, DirectiveFields {
  /**
   * Node type of leaf directive.
   */
  type: DirectiveType['Leaf'];

  /**
   * Children of leaf directive.
   */
  children: PhrasingContent[];

  /**
   * Data associated with the mdast leaf directive.
   */
  data?: LeafGrowiPluginDirectiveData | undefined;
}

/**
 * Info associated with mdast leaf directive nodes by the ecosystem.
 */
export interface LeafGrowiPluginDirectiveData extends Data {
  hName?: string;
  hProperties?: Record<string, string>;
}

/**
 * Markdown directive (text form).
 */
export interface TextGrowiPluginDirective extends Parent, DirectiveFields {
  /**
   * Node type of text directive.
   */
  type: DirectiveType['Text'];

  /**
   * Children of text directive.
   */
  children: PhrasingContent[];

  /**
   * Data associated with the text leaf directive.
   */
  data?: TextGrowiPluginDirectiveData | undefined;
}

/**
 * Info associated with mdast text directive nodes by the ecosystem.
 */
export interface TextGrowiPluginDirectiveData extends Data {
  hName?: string;
  hProperties?: Record<string, string>;
}

/**
 * Union of registered mdast directive nodes.
 *
 * It is not possible to register custom mdast directive node types.
 */
export type Directives = LeafGrowiPluginDirective | TextGrowiPluginDirective;

// Add custom data tracked to turn markdown into a tree.
declare module 'mdast-util-from-markdown' {
  interface CompileData {
    /**
     * Attributes for current directive.
     */
    directiveAttributes?: Array<[string, string]> | undefined;
  }
}

// Add custom data tracked to turn a syntax tree into markdown.
declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    /**
     * Whole leaf directive.
     *
     * ```markdown
     * > | ::a
     *     ^^^
     * ```
     */
    leafGrowiPluginDirective: 'leafGrowiPluginDirective';

    /**
     * Label of a leaf directive.
     *
     * ```markdown
     * > | ::a[b]
     *        ^^^
     * ```
     */
    leafGrowiPluginDirectiveLabel: 'leafGrowiPluginDirectiveLabel';

    /**
     * Whole text directive.
     *
     * ```markdown
     * > | :a
     *     ^^
     * ```
     */
    textGrowiPluginDirective: 'textGrowiPluginDirective';

    /**
     * Label of a text directive.
     *
     * ```markdown
     * > | :a[b]
     *       ^^^
     * ```
     */
    textGrowiPluginDirectiveLabel: 'textGrowiPluginDirectiveLabel';
  }
}

// Add nodes to content, register `data` on paragraph.
declare module 'mdast' {
  interface BlockContentMap {
    /**
     * Directive in flow content (such as in the root document, or block
     * quotes), which contains nothing.
     */
    leafGrowiPluginDirective: LeafGrowiPluginDirective;
  }

  interface PhrasingContentMap {
    /**
     * Directive in phrasing content (such as in paragraphs, headings).
     */
    textGrowiPluginDirective: TextGrowiPluginDirective;
  }

  interface RootContentMap {
    /**
     * Directive in flow content (such as in the root document, or block
     * quotes), which contains nothing.
     */
    leafGrowiPluginDirective: LeafGrowiPluginDirective;

    /**
     * Directive in phrasing content (such as in paragraphs, headings).
     */
    textGrowiPluginDirective: TextGrowiPluginDirective;
  }
}
