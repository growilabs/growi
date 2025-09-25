import type { IPageForItem } from '../../../interfaces/page';

export class ItemNode {

  page: IPageForItem;

  children: ItemNode[];

  constructor(page: IPageForItem, children: ItemNode[] = []) {
    this.page = page;
    this.children = children;
  }

  static generateNodesFromPages(pages: IPageForItem[]): ItemNode[] {
    return pages.map(page => new ItemNode(page));
  }

}
