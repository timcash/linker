import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import type {BrowserTestContext} from './types';

const README_PATH = path.resolve(process.cwd(), 'README.md');
const README_SCREENSHOT_DIR = path.resolve(process.cwd(), 'readme', 'screenshots');
const README_SHOWCASE_START = '<!-- README_SHOWCASE:START -->';
const README_SHOWCASE_END = '<!-- README_SHOWCASE:END -->';
const LIVE_SITE_BASE_URL = 'https://timcash.github.io/linker/';

type ShowcaseImage = {
  alt: string;
  caption: string;
  liveUrl: string;
  sourceFilename: string;
  targetFilename: string;
};

export async function publishReadmeShowcase(
  context: BrowserTestContext,
): Promise<void> {
  await mkdir(README_SCREENSHOT_DIR, {recursive: true});

  const showcaseImages = getShowcaseImages();

  for (const image of showcaseImages) {
    const sourcePath = path.join(context.interactionScreenshotDir, image.sourceFilename);
    const targetPath = path.join(README_SCREENSHOT_DIR, image.targetFilename);
    await copyFile(sourcePath, targetPath);
    context.addBrowserLog('artifact.readme', `Copied ${sourcePath} to ${targetPath}`);
  }

  const readmeContents = await readFile(README_PATH, 'utf8');
  const newline = readmeContents.includes('\r\n') ? '\r\n' : '\n';
  const generatedBlock = buildGeneratedReadmeBlock(showcaseImages, newline);
  const nextReadmeContents = replaceReadmeBlock(readmeContents, generatedBlock, newline);

  if (nextReadmeContents !== readmeContents) {
    await writeFile(README_PATH, nextReadmeContents, 'utf8');
    context.addBrowserLog('artifact.readme', `Updated README showcase block in ${README_PATH}`);
  }
}

function getShowcaseImages(): ShowcaseImage[] {
  return [
    {
      alt: 'Linker boot-ready mobile view',
      caption: 'Boot',
      liveUrl: buildLiveUrl(),
      sourceFilename: '01-boot-ready.png',
      targetFilename: 'boot-ready.png',
    },
    {
      alt: 'Linker classic grid zoom interaction',
      caption: 'Zoom',
      liveUrl: buildLiveUrl({
        cameraLabel: 'wp-1:2:1:1',
        demoLayers: '12',
        demoPreset: 'classic',
        labelSet: 'demo',
        stageMode: '2d-mode',
        workplane: 'wp-1',
      }),
      sourceFilename: '03-plane-focus-zoom-in.png',
      targetFilename: 'focus-zoom.png',
    },
    {
      alt: 'Linker editor ranked selection and link flow',
      caption: 'Link',
      liveUrl: buildLiveUrl({
        cameraLabel: 'wp-3:1:6:6',
        demoPreset: 'editor-lab',
        labelSet: 'demo',
        stageMode: '2d-mode',
        workplane: 'wp-3',
      }),
      sourceFilename: '14-editor-linked-selection.png',
      targetFilename: 'editor-link.png',
    },
    {
      alt: 'Linker workplane lifecycle controls',
      caption: 'Spawn',
      liveUrl: buildLiveUrl({
        cameraLabel: 'wp-3:1:6:6',
        demoPreset: 'editor-lab',
        labelSet: 'demo',
        stageMode: '2d-mode',
        workplane: 'wp-3',
      }),
      sourceFilename: '19-workplane-lifecycle-spawned.png',
      targetFilename: 'workplane-spawn.png',
    },
    {
      alt: 'Linker five-workplane stack view',
      caption: 'Stack',
      liveUrl: buildLiveUrl({
        cameraLabel: 'wp-3:1:6:6',
        demoPreset: 'workplane-showcase',
        labelSet: 'demo',
        stageMode: '3d-mode',
        workplane: 'wp-3',
      }),
      sourceFilename: '22-view-modes-3d-stack.png',
      targetFilename: 'stack-view.png',
    },
    {
      alt: 'Linker stack orbit interaction',
      caption: 'Orbit',
      liveUrl: buildLiveUrl({
        cameraLabel: 'wp-3:1:6:6',
        demoPreset: 'workplane-showcase',
        labelSet: 'demo',
        stageMode: '3d-mode',
        workplane: 'wp-3',
      }),
      sourceFilename: '27-stack-orbit-after-full-orbit.png',
      targetFilename: 'stack-orbit.png',
    },
  ];
}

function buildGeneratedReadmeBlock(
  showcaseImages: ShowcaseImage[],
  newline: string,
): string {
  const rows = [
    showcaseImages.slice(0, 3),
    showcaseImages.slice(3, 6),
  ];
  const gridLines = rows.flatMap((row) => [
    '  <tr>',
    ...row.map((image) =>
      `    <td align="center"><a href="${image.liveUrl}"><img src="./readme/screenshots/${image.targetFilename}" alt="${image.alt}" width="220" /></a><br/><sub>${image.caption}</sub></td>`,
    ),
    '  </tr>',
  ]);
  const liveLinks = [
    `- Live root: [timcash.github.io/linker](${buildLiveUrl()})`,
    '- GitHub repository: [github.com/timcash/linker](https://github.com/timcash/linker)',
  ];

  return [
    README_SHOWCASE_START,
    '',
    '<table>',
    ...gridLines,
    '</table>',
    '',
    ...liveLinks,
    '',
    'Each screenshot opens a live route with a preset `demoPreset` and `cameraLabel`.',
    README_SHOWCASE_END,
  ].join(newline);
}

function replaceReadmeBlock(
  readmeContents: string,
  generatedBlock: string,
  newline: string,
): string {
  const startIndex = readmeContents.indexOf(README_SHOWCASE_START);
  const endIndex = readmeContents.indexOf(README_SHOWCASE_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('README showcase markers are missing or out of order.');
  }

  const before = readmeContents.slice(0, startIndex);
  const after = readmeContents.slice(endIndex + README_SHOWCASE_END.length);

  return `${before}${generatedBlock}${after.startsWith(newline) ? after : `${newline}${after}`}`;
}

function buildLiveUrl(params?: Record<string, string>): string {
  const url = new URL(LIVE_SITE_BASE_URL);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}
