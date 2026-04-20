import { marked } from 'marked';

import { createSiteMenu, resolveRepoMarkdownUrl, resolveSiteHref } from './docs-shell';

const markdownDocuments = import.meta.glob<string>('../*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const readmeImageModules = import.meta.glob<string>(
  '../readme/screenshots/*.{png,jpg,jpeg,gif,svg,webp,avif}',
  {
    eager: true,
    import: 'default',
    query: '?url',
  },
);

const markdownDocumentMap = new Map<string, string>(
  Object.entries(markdownDocuments).map(([key, contents]) => [basename(key), contents]),
);
const readmeImageMap = new Map<string, string>(
  Object.entries(readmeImageModules).map(([key, assetUrl]) => [
    normalizeRelativePath(key.replace(/^\.\.\//u, '')),
    assetUrl,
  ]),
);

export type ReadmePageHandle = {
  destroy: () => void;
};

export function startReadmePage(root: HTMLElement): Promise<ReadmePageHandle> {
  document.body.classList.add('docs-route', 'readme-route');
  root.classList.add('readme-page-root');
  const siteMenu = createSiteMenu('readme');

  const shell = document.createElement('main');
  shell.className = 'page-shell docs-page readme-page';

  const requestedDoc = resolveRequestedDocumentName(window.location.search);
  const markdown = markdownDocumentMap.get(requestedDoc) ?? null;

  document.title = requestedDoc === 'README.md' ? 'Linker README' : `Linker ${requestedDoc}`;

  shell.append(
    siteMenu.element,
    createReadmeHero(requestedDoc, markdown !== null),
    createReadmeSection(requestedDoc, markdown),
  );

  root.replaceChildren(shell);

  return Promise.resolve({
    destroy: () => {
      siteMenu.destroy();
      document.body.classList.remove('docs-route', 'readme-route');
      root.classList.remove('readme-page-root');
      root.replaceChildren();
    },
  });
}

function createReadmeHero(requestedDoc: string, found: boolean): HTMLElement {
  const hero = document.createElement('header');
  hero.className = 'hero docs-hero';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Linker Docs';

  const title = document.createElement('h1');
  title.textContent = found ? `${requestedDoc} Preview` : 'Markdown Preview Not Found';

  const lede = document.createElement('p');
  lede.className = 'lede';
  lede.textContent = found
    ? 'A live preview of the repo markdown, rendered in the same monochrome Linker shell as the rest of the site.'
    : `The requested markdown document "${requestedDoc}" is not bundled into this preview route.`;

  hero.append(eyebrow, title, lede);
  return hero;
}

function createReadmeSection(requestedDoc: string, markdown: string | null): HTMLElement {
  const section = document.createElement('section');
  section.className = 'section docs-section';

  const label = document.createElement('p');
  label.className = 'section-label';
  label.textContent = 'Markdown Preview';

  const heading = document.createElement('h2');
  heading.textContent = markdown === null ? 'Available bundled docs' : 'Rendered repository notes';

  section.append(label, heading);

  if (markdown === null) {
    section.append(createMissingDocumentCallout(requestedDoc));
    return section;
  }

  const preview = document.createElement('article');
  preview.className = 'markdown-preview';
  preview.innerHTML = marked.parse(stripLeadingTitle(markdown)) as string;
  rewritePreviewDom(preview);
  section.append(preview);

  return section;
}

function createMissingDocumentCallout(requestedDoc: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'docs-callout';

  const paragraph = document.createElement('p');
  paragraph.textContent = `The preview route could not find ${requestedDoc}.`;

  const list = document.createElement('ul');
  list.className = 'list';

  for (const documentName of [...markdownDocumentMap.keys()].sort()) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `${resolveSiteHref('readme/')}?doc=${encodeURIComponent(documentName)}`;
    link.textContent = documentName;
    item.append(link);
    list.append(item);
  }

  container.append(paragraph, list);
  return container;
}

function rewritePreviewDom(container: HTMLElement): void {
  for (const image of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    const currentSrc = image.getAttribute('src');

    if (!currentSrc) {
      continue;
    }

    const resolvedSrc = resolvePreviewAssetHref(currentSrc);

    if (resolvedSrc) {
      image.src = resolvedSrc;
    }

    image.loading = 'lazy';
  }

  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const currentHref = anchor.getAttribute('href');

    if (!currentHref) {
      continue;
    }

    if (isExternalHref(currentHref)) {
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      continue;
    }

    if (currentHref.startsWith('#')) {
      continue;
    }

    const normalized = normalizeRelativePath(currentHref);

    if (normalized.endsWith('.md')) {
      const documentName = basename(normalized);

      if (markdownDocumentMap.has(documentName)) {
        anchor.href = `${resolveSiteHref('readme/')}?doc=${encodeURIComponent(documentName)}`;
      } else {
        anchor.href = resolveRepoMarkdownUrl(normalized);
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
      }

      continue;
    }

    const resolvedHref = resolvePreviewAssetHref(currentHref);

    if (resolvedHref) {
      anchor.href = resolvedHref;
    }
  }
}

function stripLeadingTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);

  if (lines[0]?.startsWith('# ')) {
    return lines.slice(1).join('\n').replace(/^\s*\n/u, '');
  }

  return markdown;
}

function resolveRequestedDocumentName(search: string): string {
  const params = new URLSearchParams(search);
  const requestedDoc = params.get('doc')?.trim();

  if (!requestedDoc) {
    return 'README.md';
  }

  const normalized = basename(requestedDoc);
  return markdownDocumentMap.has(normalized) ? normalized : requestedDoc;
}

function resolvePreviewAssetHref(rawPath: string): string | null {
  if (rawPath.startsWith('#') || isExternalHref(rawPath)) {
    return rawPath;
  }

  const normalized = normalizeRelativePath(rawPath);
  return readmeImageMap.get(normalized) ?? new URL(normalized, resolveSiteHref('./')).toString();
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/^[.][/\\]+/u, '')
    .replace(/^[/\\]+/u, '')
    .replaceAll('\\', '/');
}

function basename(value: string): string {
  return value.split('/').at(-1) ?? value;
}

function isExternalHref(value: string): boolean {
  return /^(?:[a-z]+:)?\/\//iu.test(value) || value.startsWith('mailto:') || value.startsWith('tel:');
}
