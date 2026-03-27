import {
  DEFAULT_LAYOUT_STRATEGY,
  layoutDemoEntries,
  type DemoLayoutNodeBox,
  type LayoutStrategy,
} from './demo-layout';
import {getDemoLayoutEntries} from './labels';

import type {LineDefinition} from '../line/types';
import type {LabelLocation} from '../text/types';

const DEMO_LINK_ZOOM_LEVEL = 0;
const DEMO_LINK_ZOOM_RANGE = 0.42;
const ROW_LINK_COLOR = [0.37, 0.86, 1.0, 0.44] as const;
const COLUMN_LINK_COLOR = [0.48, 0.98, 0.84, 0.4] as const;
const SPINE_LINK_COLOR = [1.0, 0.8, 0.52, 0.52] as const;
const ROW_NETWORK_BANDS = [1, 4, 7, 10] as const;
const COLUMN_NETWORK_BANDS = [2, 5, 8] as const;
const SPINE_NETWORK_BANDS = [0, 3, 6, 9] as const;

export function getDemoLinks(layoutStrategy: LayoutStrategy = DEFAULT_LAYOUT_STRATEGY): LineDefinition[] {
  const entries = getDemoLayoutEntries();
  const placement = layoutDemoEntries(entries, layoutStrategy);
  const rootBoxByKey = new Map<string, DemoLayoutNodeBox>();

  entries.forEach((entry, index) => {
    const rootBox = placement.boxes.find((box) => box.entryIndex === index && box.node === 'root');

    if (!rootBox) {
      return;
    }

    rootBoxByKey.set(
      getGridKey(entry.sourceColumnIndex, entry.sourceRowIndex),
      rootBox,
    );
  });

  const links: LineDefinition[] = [];

  for (const sourceRowIndex of ROW_NETWORK_BANDS) {
    for (let sourceColumnIndex = 0; sourceColumnIndex < 11; sourceColumnIndex += 1) {
      const bendDirection = (sourceRowIndex + sourceColumnIndex) % 2 === 0 ? 1 : -1;
      pushLink(
        links,
        rootBoxByKey,
        sourceColumnIndex,
        sourceRowIndex,
        sourceColumnIndex + 1,
        sourceRowIndex,
        {
          bendDirection,
          color: ROW_LINK_COLOR,
          curveBias: 0.22,
          curveDepth: 0.28,
          curveLift: 0.08,
          lineWidth: 3.2,
        },
      );
    }
  }

  for (const sourceColumnIndex of COLUMN_NETWORK_BANDS) {
    for (let sourceRowIndex = 0; sourceRowIndex < 11; sourceRowIndex += 1) {
      const bendDirection = (sourceColumnIndex + sourceRowIndex) % 2 === 0 ? -1 : 1;
      pushLink(
        links,
        rootBoxByKey,
        sourceColumnIndex,
        sourceRowIndex,
        sourceColumnIndex,
        sourceRowIndex + 1,
        {
          bendDirection,
          color: COLUMN_LINK_COLOR,
          curveBias: 0.16,
          curveDepth: 0.24,
          curveLift: 0.06,
          lineWidth: 2.8,
        },
      );
    }
  }

  for (const sourceRowIndex of SPINE_NETWORK_BANDS) {
    const bendDirection = sourceRowIndex % 2 === 0 ? 1 : -1;
    pushLink(
      links,
      rootBoxByKey,
      0,
      sourceRowIndex,
      11,
      sourceRowIndex,
      {
        bendDirection,
        color: SPINE_LINK_COLOR,
        curveBias: 0.34,
        curveDepth: 0.06,
        curveLift: 0.52,
        lineWidth: 3.8,
      },
    );
  }

  return links;
}

function pushLink(
  links: LineDefinition[],
  rootBoxByKey: Map<string, DemoLayoutNodeBox>,
  startColumn: number,
  startRow: number,
  endColumn: number,
  endRow: number,
  options: Pick<
    LineDefinition,
    'bendDirection' | 'color' | 'curveBias' | 'curveDepth' | 'curveLift' | 'lineWidth'
  >,
): void {
  const startBox = rootBoxByKey.get(getGridKey(startColumn, startRow));
  const endBox = rootBoxByKey.get(getGridKey(endColumn, endRow));

  if (!startBox || !endBox) {
    return;
  }

  links.push({
    ...options,
    end: getLinkPoint(endBox, startBox),
    start: getLinkPoint(startBox, endBox),
    zoomLevel: DEMO_LINK_ZOOM_LEVEL,
    zoomRange: DEMO_LINK_ZOOM_RANGE,
  });
}

function getLinkPoint(box: DemoLayoutNodeBox, towardBox: DemoLayoutNodeBox): LabelLocation {
  const center = getBoxCenter(box);
  const towardCenter = getBoxCenter(towardBox);
  const deltaX = towardCenter.x - center.x;
  const deltaY = towardCenter.y - center.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? {x: box.maxX, y: center.y}
      : {x: box.minX, y: center.y};
  }

  return deltaY >= 0
    ? {x: center.x, y: box.maxY}
    : {x: center.x, y: box.minY};
}

function getBoxCenter(box: DemoLayoutNodeBox): LabelLocation {
  return {
    x: (box.minX + box.maxX) * 0.5,
    y: (box.minY + box.maxY) * 0.5,
  };
}

function getGridKey(sourceColumnIndex: number, sourceRowIndex: number): string {
  return `${sourceColumnIndex}:${sourceRowIndex}`;
}
