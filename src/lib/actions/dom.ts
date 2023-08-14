import { AnyNode, Cheerio } from 'cheerio';
import type { ElementHandle, JSHandle, Locator, Page } from 'playwright';

import { StrAsNumOptions, strAsNumber, strOrNull } from '../../utils/format';
import { FormatUrlOptions, formatUrl } from '../../utils/url';
import type { MaybePromise } from '../../utils/types';
import { mergeHandles, splitCheerioSelection, splitPlaywrightSelection } from './domUtils';

/**
 * Common interface for working with DOM despite different environments.
 *
 * Consider these environments:
 * 1) Browser (via Playwright & Chromium) - uses Browser API to work with DOM
 * 2) Cheerio - uses own API to work with DOM
 *
 * This common interfaces makes the scraping code more portable between the two.
 */
export interface DOMLib<El extends BaseEl, BaseEl> {
  node: El | null;

  ///////////////////////
  // SCALAR OPERATIONS
  ///////////////////////

  /** Get element's text (trimmed) */
  text: (options?: { allowEmpty?: boolean }) => MaybePromise<string | null>;
  /** Get element's text as uppercase (trimmed) */
  textAsUpper: (options?: { allowEmpty?: boolean }) => MaybePromise<string | null>;
  /** Get element's text as lowercase (trimmed) */
  textAsLower: (options?: { allowEmpty?: boolean }) => MaybePromise<string | null>;
  /** Get element's text and convert it to number */
  textAsNumber: (options?: StrAsNumOptions) => MaybePromise<number | null>;
  /** Get element's attribute */
  attr: (attrName: string, options?: { allowEmpty?: boolean }) => MaybePromise<string | null>;
  /** Get element's property */
  prop: (propName: string, options?: { allowEmpty?: boolean }) => MaybePromise<string | null>;
  /** Get element's href */
  href: (options?: { allowEmpty?: boolean } & FormatUrlOptions) => MaybePromise<string | null>;
  /** Get element's src */
  src: (options?: { allowEmpty?: boolean } & FormatUrlOptions) => MaybePromise<string | null>;
  /** Get element's nodeName */
  nodeName: () => MaybePromise<string | null>;
  /** Get URL of website associated with the DOM */
  url: () => MaybePromise<string | null>;
  /** Freely modify the underlying DOM node */
  map: <TVal>(map: (node: El | null) => TVal) => MaybePromise<TVal>;

  ///////////////////////
  // NODE OPERATIONS
  ///////////////////////

  /** Get a single descendant matching the selector */
  findOne: <TNewEl extends BaseEl = El>(selector: string) => MaybePromise<DOMLib<TNewEl, BaseEl> | null>; // prettier-ignore
  /** Get all descendants matching the selector */
  findMany: <TNewEl extends BaseEl = El>(selector: string) => MaybePromise<DOMLib<TNewEl, BaseEl>[]>; // prettier-ignore
  /** Get element's parent */
  parent: <TNewEl extends BaseEl = El>() => MaybePromise<DOMLib<TNewEl, BaseEl> | null>;
  /** Get element's children */
  children: <TNewEl extends BaseEl = El>() => MaybePromise<DOMLib<TNewEl, BaseEl>[]>;
  /** Get remove the element */
  remove: () => MaybePromise<void>;
  /** Get root element */
  root: <TNewEl extends BaseEl = El>() => MaybePromise<DOMLib<TNewEl, BaseEl> | null>;

  /**
   * Given two elements, return closest ancestor element that encompases them both,
   * or `null` if none such found.
   */
  getCommonAncestor: (otherEl: El) => MaybePromise<El | null>;
  /**
   * Given a selector, find all DOM elements that match the selector,
   * and return closest ancestor element that encompases them all,
   * or `null` if none such found.
   */
  getCommonAncestorFromSelector: (selector: string) => MaybePromise<El | null>;
}

export type BrowserDOMLib<T extends Element = Element> = DOMLib<T, Element>;

/** Implementation of DOMLib in browser (using Browser API) */
export const browserDOMLib = <T extends Element>(node: T): BrowserDOMLib<T> => {
  ///////////////////////
  // SCALAR OPERATIONS
  ///////////////////////

  const text: BrowserDOMLib<T>['text'] = ({ allowEmpty } = {}) => {
    const txt = node.textContent?.trim() ?? null;
    return strOrNull(txt, allowEmpty);
  };

  const textAsUpper: BrowserDOMLib<T>['textAsUpper'] = (options) => {
    const txt = text(options);
    return txt ? (txt as string).toLocaleUpperCase() : txt;
  };

  const textAsLower: BrowserDOMLib<T>['textAsLower'] = (options) => {
    const txt = text(options);
    return txt ? (txt as string).toLocaleLowerCase() : txt;
  };

  const textAsNumber: BrowserDOMLib<T>['textAsNumber'] = (options) => {
    const txt = text(options);
    return strAsNumber(txt as string, options);
  };

  const prop: BrowserDOMLib<T>['prop'] = (propName, { allowEmpty } = {}) => {
    let propVal = node[propName] ?? null;
    propVal = typeof propVal === 'string' ? propVal.trim() : propVal;
    return strOrNull(propVal, allowEmpty);
  };

  const attr: BrowserDOMLib<T>['attr'] = (propName, { allowEmpty } = {}) => {
    let attrVal = node.getAttribute(propName) ?? null;
    attrVal = typeof attrVal === 'string' ? attrVal.trim() : attrVal;
    return strOrNull(attrVal, allowEmpty);
  };

  const href: BrowserDOMLib<T>['href'] = ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = prop('href', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const src: BrowserDOMLib<T>['src'] = ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = prop('src', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const nodeName: BrowserDOMLib<T>['nodeName'] = () => {
    // On UPPER- vs lower-case https://stackoverflow.com/questions/27223756/
    const val = prop('nodeName');
    return typeof val === 'string' ? val.toLocaleUpperCase() : val;
  };

  const url: BrowserDOMLib<T>['url'] = () => {
    const doc = node.ownerDocument;
    // See https://stackoverflow.com/a/16010322/9788634
    const urlVal = doc.defaultView?.location?.href || null;
    return urlVal;
  };

  const map: BrowserDOMLib<T>['map'] = <TVal>(mapFn: (node: T) => TVal) => {
    return mapFn(node);
  };

  ///////////////////////
  // NODE OPERATIONS
  ///////////////////////

  const findOne: BrowserDOMLib<T>['findOne'] = <TNewEl extends Element = T>(selector) => {
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE].includes(node.nodeType as any)) return null;
    const resultEl = (node.querySelector(selector) ?? null) as TNewEl | null;
    return resultEl ? browserDOMLib(resultEl) : null;
  };

  const findMany: BrowserDOMLib<T>['findMany'] = <TNewEl extends Element = T>(selector) => {
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE].includes(node.nodeType as any)) return [];
    const resultEls = [...node.querySelectorAll(selector)] as TNewEl[]; // prettier-ignore
    return resultEls.map((el) => browserDOMLib(el));
  };

  const parent: BrowserDOMLib<T>['parent'] = <TNewEl extends Element = T>() => {
    const parentEl = (node.parentNode || null) as TNewEl | null;
    return parentEl ? browserDOMLib(parentEl) : null;
  };

  const children: BrowserDOMLib<T>['children'] = <TNewEl extends Element = T>() => {
    const childEls = [...node.children] as TNewEl[];
    return childEls.map((el) => browserDOMLib(el));
  };

  const root: BrowserDOMLib<T>['root'] = <TNewEl extends Element = T>() => {
    const rootEl = ((node.ownerDocument?.documentElement as any) || null) as TNewEl | null;
    return rootEl ? browserDOMLib(rootEl) : null;
  };

  const remove: BrowserDOMLib<T>['remove'] = () => {
    node.remove();
  };

  const _getCommonAncestor = <T extends Node>(el1: T, el2: T) => {
    // https://stackoverflow.com/a/25154092
    // https://developer.mozilla.org/en-US/docs/Web/API/Range/commonAncestorContainer
    const _getCommonAncestorFromRange = (el1: T, el2: T) => {
      const range = new Range();
      range.setStartBefore(el1);
      range.setEndAfter(el2);
      const containerEl = range.commonAncestorContainer;
      return containerEl;
    };

    // https://developer.mozilla.org/en-US/docs/Web/API/Node/compareDocumentPosition
    const isEl1BeforeEl2 = !!(el1.compareDocumentPosition(el2) & Node.DOCUMENT_POSITION_FOLLOWING);

    const { firstEl, lastEl } = isEl1BeforeEl2
      ? { firstEl: el1, lastEl: el2 }
      : { firstEl: el2, lastEl: el1 };

    const containerEl = _getCommonAncestorFromRange(firstEl, lastEl);
    return containerEl as T | null;
  };

  const getCommonAncestor: BrowserDOMLib<T>['getCommonAncestor'] = (otherEl) => {
    return _getCommonAncestor(node, otherEl) as T | null;
  };

  const getCommonAncestorFromSelector = _createCommonAncestorFromSelectorFn<T>({
    querySelectorAll: (selector) => node.querySelectorAll(selector) as Iterable<T>,
    getParent: (el) => el.parentElement as T | null,
    isAncestor: (el1, el2) => {
      return !!(el1.compareDocumentPosition(el2) & Node.DOCUMENT_POSITION_CONTAINED_BY);
    },
    getCommonAncestor: (el1, el2) => _getCommonAncestor(el1, el2),
  });

  return {
    node,

    text,
    textAsLower,
    textAsUpper,
    textAsNumber,
    attr,
    prop,
    href,
    src,
    nodeName,
    url,
    map,

    findOne,
    findMany,
    parent,
    children,
    root,
    remove,
    getCommonAncestor,
    getCommonAncestorFromSelector,
  } satisfies DOMLib<T, Element>;
};

export type CheerioDOMLib<T extends Cheerio<AnyNode> = Cheerio<AnyNode>> = DOMLib<
  T,
  Cheerio<AnyNode>
>;

/** Implementation of DOMLib in Cheerio */
export const cheerioDOMLib = <T extends Cheerio<AnyNode>>(
  cheerioNode: T,
  srcUrl: string | null
): CheerioDOMLib<T> => {
  ///////////////////////
  // SCALAR OPERATIONS
  ///////////////////////

  const text: CheerioDOMLib<T>['text'] = ({ allowEmpty } = {}) => {
    const txt = cheerioNode.text()?.trim() ?? null;
    return strOrNull(txt, allowEmpty);
  };

  const textAsUpper: CheerioDOMLib<T>['textAsUpper'] = (options) => {
    const txt = text(options);
    return txt ? (txt as string).toLocaleUpperCase() : txt;
  };

  const textAsLower: CheerioDOMLib<T>['textAsLower'] = (options) => {
    const txt = text(options);
    return txt ? (txt as string).toLocaleLowerCase() : txt;
  };

  const textAsNumber: CheerioDOMLib<T>['textAsNumber'] = (options) => {
    const txt = text(options);
    return strAsNumber(txt as string, options);
  };

  const attr: CheerioDOMLib<T>['attr'] = (attrName, { allowEmpty } = {}) => {
    let attrVal = cheerioNode.attr(attrName) ?? null;
    attrVal = typeof attrVal === 'string' ? attrVal.trim() : attrVal;
    return strOrNull(attrVal, allowEmpty);
  };

  const prop: CheerioDOMLib<T>['prop'] = (propName, { allowEmpty } = {}) => {
    let propVal = cheerioNode.prop(propName) ?? null;
    propVal = typeof propVal === 'string' ? propVal.trim() : propVal;
    return strOrNull(propVal, allowEmpty);
  };

  const href: CheerioDOMLib<T>['href'] = ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = prop('href', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const src: CheerioDOMLib<T>['src'] = ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = prop('src', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const nodeName: CheerioDOMLib<T>['nodeName'] = () => {
    // On UPPER- vs lower-case https://stackoverflow.com/questions/27223756/
    const val = prop('nodeName');
    return typeof val === 'string' ? val.toLocaleUpperCase() : val;
  };

  const url: CheerioDOMLib<T>['url'] = () => {
    return srcUrl ?? null;
  };

  const map: CheerioDOMLib<T>['map'] = <TVal>(mapFn: (node: T) => TVal) => {
    return mapFn(cheerioNode);
  };

  ///////////////////////
  // NODE OPERATIONS
  ///////////////////////

  const findOne: CheerioDOMLib<T>['findOne'] = <TNewEl extends Cheerio<AnyNode> = T>(selector) => {
    const resultEl = cheerioNode.find(selector).first() as TNewEl;
    if (!resultEl.get(0)) return null;
    return cheerioDOMLib(resultEl, srcUrl);
  };

  const findMany: CheerioDOMLib<T>['findMany'] = <TNewEl extends Cheerio<AnyNode> = T>(
    selector
  ) => {
    const resultEls = splitCheerioSelection(cheerioNode.find(selector)) as TNewEl[];
    return resultEls.map((ch) => cheerioDOMLib(ch, srcUrl));
  };

  const parent: CheerioDOMLib<T>['parent'] = <TNewEl extends Cheerio<AnyNode> = T>() => {
    const parentEl = cheerioNode.parent().first() as TNewEl;
    if (!parentEl.get(0)) return null;
    return cheerioDOMLib(parentEl, srcUrl);
  };

  const children: CheerioDOMLib<T>['children'] = <TNewEl extends Cheerio<AnyNode> = T>() => {
    const childEls = splitCheerioSelection(cheerioNode.children()) as TNewEl[];
    return childEls.map((ch) => cheerioDOMLib(ch, srcUrl));
  };

  const root: CheerioDOMLib<T>['root'] = <TNewEl extends Cheerio<AnyNode> = T>() => {
    const rootEl = cheerioNode._root?.first() as TNewEl | null;
    if (!rootEl?.get(0)) return null;
    return cheerioDOMLib(rootEl, srcUrl);
  };

  const remove: CheerioDOMLib<T>['remove'] = () => {
    cheerioNode.remove();
  };

  /** Function that finds the closest common ancestor for `el1` and `el2`. */
  const _getCommonAncestor = async (el1: T, el2: T) => {
    const ch1Parents = splitCheerioSelection(el1.parents()) as T[];
    const ch2Parents = splitCheerioSelection(el2.parents()) as T[];

    let commonAncestor: T | null = null;
    for (const comparerParent of ch1Parents) {
      for (const compareeParent of ch2Parents) {
        if (!comparerParent.is(compareeParent)) continue;
        commonAncestor = comparerParent;
        break;
      }
    }
    return commonAncestor;
  };

  const getCommonAncestor: CheerioDOMLib<T>['getCommonAncestor'] = (otherEl) => {
    return _getCommonAncestor(cheerioNode, otherEl);
  };

  const getCommonAncestorFromSelector = _createCommonAncestorFromSelectorFn<T>({
    querySelectorAll: (selector) => splitCheerioSelection(cheerioNode.find(selector)) as T[],
    getParent: (el) => el.parent() as T | null,
    isAncestor: (el1, el2) => el1.is(el2.parents()),
    getCommonAncestor: (el1, el2) => _getCommonAncestor(el1, el2),
  });

  return {
    node: cheerioNode,

    text,
    textAsLower,
    textAsUpper,
    textAsNumber,
    attr,
    prop,
    href,
    src,
    nodeName,
    url,
    map,

    findOne,
    findMany,
    parent,
    children,
    root,
    remove,
    getCommonAncestor,
    getCommonAncestorFromSelector,
  } satisfies CheerioDOMLib<T>;
};

export type PlaywrightDOMLib<
  T extends Locator | ElementHandle<Node> = Locator | ElementHandle<Node>
> = DOMLib<T, Locator | ElementHandle<Node>>;

/** Implementation of DOMLib in Playwright */
export const playwrightDOMLib = <T extends Locator | ElementHandle<Node>>(
  node: T,
  page: Page
): PlaywrightDOMLib<T> => {
  ///////////////////////
  // SCALAR OPERATIONS
  ///////////////////////

  const text: PlaywrightDOMLib<T>['text'] = async ({ allowEmpty } = {}) => {
    const txt = (await node.textContent())?.trim() ?? null;
    return strOrNull(txt, allowEmpty);
  };

  const textAsUpper: PlaywrightDOMLib<T>['textAsUpper'] = async (options) => {
    const txt = await text(options);
    return txt ? txt.toLocaleUpperCase() : txt;
  };

  const textAsLower: PlaywrightDOMLib<T>['textAsLower'] = async (options) => {
    const txt = await text(options);
    return txt ? txt.toLocaleLowerCase() : txt;
  };

  const textAsNumber: PlaywrightDOMLib<T>['textAsNumber'] = async (options) => {
    const txt = await text(options);
    return strAsNumber(txt, options);
  };

  const prop: PlaywrightDOMLib<T>['prop'] = async (propName, { allowEmpty } = {}) => {
    let propVal =
      (await (node as Locator).evaluate((el, propName) => el[propName], propName)) ?? null;
    propVal = typeof propVal === 'string' ? propVal.trim() : propVal;
    return strOrNull(propVal, allowEmpty);
  };

  const attr: PlaywrightDOMLib<T>['attr'] = async (attrName, { allowEmpty } = {}) => {
    let attrVal = (await node.getAttribute(attrName)) ?? null;
    attrVal = typeof attrVal === 'string' ? attrVal.trim() : attrVal;
    return strOrNull(attrVal, allowEmpty);
  };

  const href: PlaywrightDOMLib<T>['href'] = async ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = await prop('href', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const src: PlaywrightDOMLib<T>['src'] = async ({ allowEmpty, allowRelative, baseUrl } = {}) => {
    const val = await prop('src', { allowEmpty });
    return formatUrl(val, { allowRelative, baseUrl });
  };

  const nodeName: PlaywrightDOMLib<T>['nodeName'] = async () => {
    // On UPPER- vs lower-case https://stackoverflow.com/questions/27223756/
    const val = await prop('nodeName');
    return typeof val === 'string' ? val.toLocaleUpperCase() : val;
  };

  const url: PlaywrightDOMLib<T>['url'] = async () => {
    return page.url() || null;
  };

  const map: PlaywrightDOMLib<T>['map'] = <TVal>(mapFn: (node: T) => TVal) => {
    return mapFn(node);
  };

  ///////////////////////
  // NODE OPERATIONS
  ///////////////////////

  const findOne: PlaywrightDOMLib<T>['findOne'] = async <
    TNewEl extends Locator | ElementHandle<Node> = T
  >(
    selector
  ) => {
    const resultEl = await node.evaluateHandle((el, s) => {
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE].includes(el.nodeType as any)) return null;
      return (el as Element).querySelector(s) || null;
    }, selector);
    const hasResult = await resultEl.evaluate((el) => !!el);
    return hasResult ? playwrightDOMLib(resultEl as TNewEl, page) : null;
  };

  const findMany: PlaywrightDOMLib<T>['findMany'] = async <
    TNewEl extends Locator | ElementHandle<Node> = T
  >(
    selector
  ) => {
    const elsHandle = await node.evaluateHandle((el, s) => {
      if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE].includes(el.nodeType as any)) return [];
      return [...(el as Element).querySelectorAll<Element>(s)];
    }, selector);
    const resultEls = await splitPlaywrightSelection<any>(elsHandle);
    return resultEls.map((el) => playwrightDOMLib(el as TNewEl, page));
  };

  const parent: PlaywrightDOMLib<T>['parent'] = async <
    TNewEl extends Locator | ElementHandle<Node> = T
  >() => {
    const parentEl = await node.evaluateHandle((el) => el.parentElement || null);
    const hasResult = await parentEl.evaluate((el) => !!el);
    return hasResult ? playwrightDOMLib(parentEl as TNewEl, page) : null;
  };

  const children: PlaywrightDOMLib<T>['children'] = async <
    TNewEl extends Locator | ElementHandle<Node> = T
  >() => {
    const elsHandle = await node.evaluateHandle((el) => [...(el as Element).children]);
    const resultEls = await splitPlaywrightSelection<any>(elsHandle);
    return resultEls.map((el) => playwrightDOMLib(el as TNewEl, page));
  };

  const root: PlaywrightDOMLib<T>['root'] = async <
    TNewEl extends Locator | ElementHandle<Node> = T
  >() => {
    const rootEl = await node.evaluateHandle((el) => el.ownerDocument?.documentElement || null);
    const hasResult = await rootEl.evaluate((el) => !!el);
    return hasResult ? playwrightDOMLib(rootEl as TNewEl, page) : null;
  };

  const remove: PlaywrightDOMLib<T>['remove'] = async () => {
    await (node as Locator).evaluate((el) => el.remove());
  };

  const _getCommonAncestor = async (loc1: T, loc2: T) => {
    const isEl1BeforeEl2 = await (
      await mergeHandles([loc1, loc2])
    ).evaluate(([el1, el2]) => {
      if (!el1 || !el2) return false;
      // https://developer.mozilla.org/en-US/docs/Web/API/Node/compareDocumentPosition
      const result = !!(el1.compareDocumentPosition(el2) & Node.DOCUMENT_POSITION_FOLLOWING);
      return result;
    });

    const { firstEl, lastEl } = isEl1BeforeEl2
      ? { firstEl: loc1, lastEl: loc2 }
      : { firstEl: loc2, lastEl: loc1 };

    const ancestor = await (
      await mergeHandles([firstEl, lastEl])
    ).evaluateHandle(([el1, el2]) => {
      if (!el1 || !el2) return null;
      // https://stackoverflow.com/a/25154092
      // https://developer.mozilla.org/en-US/docs/Web/API/Range/commonAncestorContainer
      const range = new Range();
      range.setStartBefore(el1);
      range.setEndAfter(el2);
      const containerEl = range.commonAncestorContainer;
      return containerEl;
    });

    const hasResult = await (ancestor as JSHandle).evaluate((el) => !!el);
    return hasResult ? (ancestor as T) : null;
  };

  const getCommonAncestor: PlaywrightDOMLib<T>['getCommonAncestor'] = async (otherEl) => {
    return _getCommonAncestor(node, otherEl);
  };

  const getCommonAncestorFromSelector = _createCommonAncestorFromSelectorFn<T>({
    querySelectorAll: async (selector) => {
      const elsHandle = await (node as Locator).evaluateHandle(
        (el, s) => [...el.querySelectorAll(s)],
        selector
      );
      const resultEls = await splitPlaywrightSelection<any>(elsHandle);
      return resultEls as T[];
    },
    getParent: async (el) => {
      const parentEl = await el.evaluateHandle((el) => el.parentElement || null);
      const hasResult = await parentEl.evaluate((el) => !!el);
      return hasResult ? (parentEl as T) : null;
    },
    isAncestor: async (el1, el2) => {
      return (await mergeHandles([el1, el2])).evaluate(([el1, el2]) => {
        if (!el1 || !el2) return false;
        // https://developer.mozilla.org/en-US/docs/Web/API/Node/compareDocumentPosition
        const result = !!(el1.compareDocumentPosition(el2) & Node.DOCUMENT_POSITION_CONTAINED_BY);
        return result;
      });
    },
    getCommonAncestor: _getCommonAncestor,
  });

  return {
    node,

    text,
    textAsLower,
    textAsUpper,
    textAsNumber,
    attr,
    prop,
    href,
    src,
    nodeName,
    url,
    map,

    findOne,
    findMany,
    parent,
    children,
    root,
    remove,
    getCommonAncestor,
    getCommonAncestorFromSelector,
  } satisfies PlaywrightDOMLib<T>;
};

const _createCommonAncestorFromSelectorFn = <T>(input: {
  querySelectorAll: (selector: string) => MaybePromise<Iterable<T> | T[]>;
  getParent: (el: T) => MaybePromise<T | null>;
  /** Function that returns `true` if `el1` is ancestor of `el2`. */
  isAncestor: (el1: T, el2: T) => MaybePromise<boolean>;
  /** Function that finds the closest common ancestor for `el1` and `el2`. */
  getCommonAncestor: (el1: T, el2: T) => MaybePromise<T | null>;
}) => {
  const getCommonAncestorFromSelector = async (selector: string): Promise<T | null> => {
    const els = [...(await input.querySelectorAll(selector))];
    if (!els.length) return null;
    if (els.length === 1) return input.getParent(els[0]);

    const comparerEl = els.shift();
    let ancestorEl: T | null = null;
    for (const el of els) {
      const currAncestorEl = comparerEl ? await input.getCommonAncestor(comparerEl, el) : null;
      const newAncestorEl = !ancestorEl
        ? currAncestorEl
        : currAncestorEl && (await input.isAncestor(currAncestorEl, ancestorEl))
        ? currAncestorEl
        : ancestorEl;
      ancestorEl = newAncestorEl;
    }

    return ancestorEl as T;
  };

  return getCommonAncestorFromSelector;
};
