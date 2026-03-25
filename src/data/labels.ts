import demoLabelSetCsv from './demo-label-set.csv?raw';

import type {LabelDefinition, RgbaColor} from '../text/types';

type DemoSeedSlot = Omit<LabelDefinition, 'text'> & {
  fallbackText: string;
};

type DemoBand = {
  anchors: ReadonlyArray<{x: number; y: number}>;
  color: RgbaColor;
  fallbackTexts: readonly string[];
  maxZoom: number;
  minZoom: number;
  size: number;
};

const DEMO_SEED_SLOTS: readonly DemoSeedSlot[] = [
  {
    fallbackText: 'BUTTON PAN',
    location: {x: -4.2, y: -2.7},
    maxZoom: 0.15,
    minZoom: -4,
    size: 1.1,
  },
  {
    fallbackText: 'WEBGPU LABEL',
    location: {x: 2.2, y: 0.25},
    maxZoom: 0.7,
    minZoom: -0.2,
    size: 1,
    color: [0.96, 0.98, 1, 1],
  },
  {
    fallbackText: 'LUMA TEXT',
    location: {x: 3.4, y: 2.45},
    maxZoom: 1.8,
    minZoom: 0.2,
    size: 1.1,
    color: [0.78, 0.91, 1, 1],
  },
  {
    fallbackText: 'MID DETAIL',
    location: {x: 4.1, y: 1},
    maxZoom: 2.2,
    minZoom: 0.7,
    size: 0.9,
    color: [0.84, 0.95, 1, 1],
  },
  {
    fallbackText: 'CLOSE READ',
    location: {x: 4.4, y: -1.7},
    maxZoom: 4,
    minZoom: 0.95,
    size: 0.8,
    color: [0.92, 0.96, 1, 1],
  },
  {
    fallbackText: 'WORLD VIEW',
    location: {x: 4.5, y: 3},
    maxZoom: -0.3,
    minZoom: -4,
    size: 1.2,
    color: [0.87, 0.94, 1, 1],
  },
] as const;

const DEMO_BANDS: readonly DemoBand[] = [
  {
    fallbackTexts: [
      'GRID LAYER',
      'TEXT LAYER',
      'TEXT STRATEGY',
      'FRAME TELEMETRY',
      'STATIC LABEL SET',
      'CAMERA TRACE',
    ],
    anchors: [
      {x: -8.1, y: 4.6},
      {x: -0.4, y: 5.1},
      {x: 7.1, y: 4.4},
      {x: -8.0, y: -4.2},
      {x: -0.2, y: -4.8},
      {x: 7.3, y: -4.0},
    ],
    color: [0.9, 0.95, 1, 1],
    maxZoom: -0.35,
    minZoom: -4,
    size: 1.06,
  },
  {
    fallbackTexts: [
      'RENDER PANEL',
      'DETAILS PANEL',
      'STATUS PANEL',
      'CAMERA PANEL',
      'STAGE CANVAS',
      'GLYPH ATLAS',
      'GLYPH LAYOUT',
      'ANCHOR FIELD',
    ],
    anchors: [
      {x: -7.1, y: 2.2},
      {x: -4.0, y: 1.7},
      {x: -0.9, y: 1.9},
      {x: 1.7, y: 1.6},
      {x: -6.6, y: -0.6},
      {x: -3.4, y: -0.8},
      {x: -0.3, y: -0.6},
      {x: 2.4, y: -0.9},
    ],
    color: [0.85, 0.94, 1, 1],
    maxZoom: 0.8,
    minZoom: -0.15,
    size: 0.98,
  },
  {
    fallbackTexts: [
      'VISIBLE SET',
      'CHUNK INDEX',
      'ZOOM BAND',
      'DRAW PASS',
      'SUBMIT COUNT',
      'GPU SAMPLE',
      'CPU SAMPLE',
      'PIXEL GRID',
    ],
    anchors: [
      {x: -5.4, y: 3.8},
      {x: -2.6, y: 3.4},
      {x: 0.3, y: 3.2},
      {x: 2.8, y: 3.4},
      {x: -5.0, y: 0.9},
      {x: -2.1, y: 0.8},
      {x: 0.7, y: 0.9},
      {x: 3.1, y: 0.6},
    ],
    color: [0.79, 0.91, 1, 1],
    maxZoom: 1.75,
    minZoom: 0.2,
    size: 0.9,
  },
  {
    fallbackTexts: [
      'WORLD AXIS',
      'LABEL CLUSTER',
      'TEXT BATCH',
      'RUNTIME STAGE',
      'VIEWPORT TILE',
    ],
    anchors: [
      {x: -3.6, y: 2.2},
      {x: -1.1, y: 2.0},
      {x: 1.0, y: 2.0},
      {x: -3.1, y: -1.9},
      {x: -0.6, y: -2.1},
    ],
    color: [0.86, 0.95, 1, 1],
    maxZoom: 2.6,
    minZoom: 0.8,
    size: 0.82,
  },
  {
    fallbackTexts: [
      'PAN LANE',
      'ZOOM GATE',
      'ATLAS RECORD',
    ],
    anchors: [
      {x: -1.4, y: 0.5},
      {x: 0.7, y: 0.4},
      {x: -0.1, y: -1.0},
    ],
    color: [0.92, 0.97, 1, 1],
    maxZoom: 4,
    minZoom: 1.35,
    size: 0.74,
  },
] as const;

const DEMO_TEXT_ITEMS = parseSingleColumnCsv(demoLabelSetCsv);

export const DEMO_LABELS: LabelDefinition[] = createDemoLabels(DEMO_TEXT_ITEMS);

function createDemoLabels(texts: string[]): LabelDefinition[] {
  const labels: LabelDefinition[] = DEMO_SEED_SLOTS.map(({fallbackText, ...slot}, index) => ({
    ...slot,
    text: texts[index] ?? fallbackText,
  }));

  let cursor = DEMO_SEED_SLOTS.length;

  for (const band of DEMO_BANDS) {
    for (let index = 0; index < band.anchors.length; index += 1) {
      labels.push({
        text: texts[cursor] ?? band.fallbackTexts[index] ?? `DEMO LABEL ${cursor + 1}`,
        location: band.anchors[index],
        size: band.size,
        minZoom: band.minZoom,
        maxZoom: band.maxZoom,
        color: band.color,
      });
      cursor += 1;
    }
  }

  return labels;
}

function parseSingleColumnCsv(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(stripWrappingQuotes);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}
