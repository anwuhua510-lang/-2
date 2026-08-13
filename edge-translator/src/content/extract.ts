/**
 * 页面文本提取（M3）。
 *
 * 只提取可见文本节点；一个块对应一个或多个同父且相邻的文本节点。
 */

export interface ExtractedBlock {
  id: string;
  text: string;
  nodes: Text[];
  original: string[];
  /** 内部使用：块所在父元素 */
  parent: HTMLElement;
  /** 内部使用：块内最后一个文本节点，用于判断相邻合并 */
  lastNode: Text;
}

const EXCLUDED_SELECTOR = [
  'script',
  'style',
  'noscript',
  'svg',
  'math',
  'code',
  'pre',
  'textarea',
  'select',
  'option',
  '[hidden]',
  '[contenteditable="true"]',
].join(',');

export function extractBlocks(
  root: ParentNode,
  maxBlocks: number,
): { blocks: ExtractedBlock[]; truncated: boolean } {
  const blocks: ExtractedBlock[] = [];
  let truncated = false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue ?? '';
      if (text.trim() === '') return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(EXCLUDED_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let lastBlock: ExtractedBlock | undefined;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (blocks.length >= maxBlocks) {
      truncated = true;
      break;
    }
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent) continue;

    if (
      lastBlock &&
      lastBlock.parent === parent &&
      textNode.previousSibling === lastBlock.lastNode
    ) {
      const separator = /\s$/.test(lastBlock.lastNode.nodeValue ?? '') ? '' : ' ';
      lastBlock.text += separator + (textNode.nodeValue ?? '');
      lastBlock.nodes.push(textNode);
      lastBlock.original.push(textNode.nodeValue ?? '');
      lastBlock.lastNode = textNode;
      continue;
    }

    const block: ExtractedBlock = {
      id: String(blocks.length),
      text: textNode.nodeValue ?? '',
      nodes: [textNode],
      original: [textNode.nodeValue ?? ''],
      parent,
      lastNode: textNode,
    };
    blocks.push(block);
    lastBlock = block;
  }

  return { blocks, truncated };
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }
  // 零尺寸容器（如折叠面板）跳过，避免翻译不可见内容
  if (element.getClientRects().length === 0) return false;
  return true;
}
