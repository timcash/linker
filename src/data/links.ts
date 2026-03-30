import {
  DEFAULT_LAYOUT_STRATEGY,
  layoutDemoEntries,
  type DemoLayoutNodeBox,
  type LayoutStrategy,
} from './demo-layout';
import {getDemoLayoutEntries} from './labels';

import type {LinkDefinition, LinkPoint} from '../line/types';
import type {LabelLocation, RgbaColor} from '../text/types';

const DEMO_LINK_ZOOM_LEVEL = 0;
const DEMO_LINK_ZOOM_RANGE = 2.4;
const ROW_NETWORK_BANDS = [1, 4, 7, 10] as const;
const COLUMN_NETWORK_BANDS = [2, 5, 8] as const;
const DIAGONAL_NETWORK_BANDS = [0, 4, 8] as const;
const FANOUT_NETWORK_BANDS = [0, 4, 8] as const;
const SPINE_NETWORK_BANDS = [0, 3, 6, 9] as const;
const COLUMN_DISTANCE_LINK_COLORS = [
  [0.48, 0.98, 0.84, 0.42],
  [0.37, 0.86, 1.0, 0.46],
  [0.46, 0.74, 1.0, 0.46],
  [0.62, 0.68, 1.0, 0.48],
  [0.82, 0.62, 1.0, 0.48],
  [0.98, 0.62, 0.94, 0.48],
  [1.0, 0.62, 0.8, 0.48],
  [1.0, 0.68, 0.58, 0.5],
  [1.0, 0.8, 0.52, 0.52],
  [0.82, 0.94, 0.46, 0.48],
  [0.58, 0.96, 0.66, 0.46],
  [1.0, 0.82, 0.46, 0.54],
] as const;

type ResolvedLinkPoint = {
  linkPoint: LinkPoint;
  location: LabelLocation;
};

export function getDemoLinks(layoutStrategy: LayoutStrategy = DEFAULT_LAYOUT_STRATEGY): LinkDefinition[] {
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

  const links: LinkDefinition[] = [];

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
          curveBias: 0.22,
          curveDepth: 0.28,
          curveLift: 0.08,
          lineWidth: 2.2,
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
          curveBias: 0.16,
          curveDepth: 0.24,
          curveLift: 0.06,
          lineWidth: 1.9,
        },
      );
    }
  }

  for (const sourceRowIndex of DIAGONAL_NETWORK_BANDS) {
    for (let sourceColumnIndex = 0; sourceColumnIndex < 11; sourceColumnIndex += 1) {
      pushLink(
        links,
        rootBoxByKey,
        sourceColumnIndex,
        sourceRowIndex,
        sourceColumnIndex + 1,
        sourceRowIndex + 1,
        {
          bendDirection: sourceRowIndex % 2 === 0 ? 1 : -1,
          curveBias: 0.2,
          curveDepth: 0.26,
          curveLift: 0.14,
          lineWidth: 2.1,
        },
      );
    }
  }

  for (const sourceRowIndex of FANOUT_NETWORK_BANDS) {
    for (let sourceColumnIndex = 0; sourceColumnIndex < 11; sourceColumnIndex += 1) {
      pushLink(
        links,
        rootBoxByKey,
        sourceColumnIndex,
        sourceRowIndex,
        sourceColumnIndex + 1,
        sourceRowIndex + 2,
        {
          bendDirection: sourceColumnIndex % 2 === 0 ? -1 : 1,
          curveBias: 0.3,
          curveDepth: 0.18,
          curveLift: 0.18,
          lineWidth: 2,
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
        curveBias: 0.34,
        curveDepth: 0.06,
        curveLift: 0.52,
        lineWidth: 2.8,
      },
    );
  }

  return links;
}

function pushLink(
  links: LinkDefinition[],
  rootBoxByKey: Map<string, DemoLayoutNodeBox>,
  startColumn: number,
  startRow: number,
  endColumn: number,
  endRow: number,
  options: Pick<
    LinkDefinition,
    'bendDirection' | 'curveBias' | 'curveDepth' | 'curveLift' | 'lineWidth'
  >,
): void {
  const startBox = rootBoxByKey.get(getGridKey(startColumn, startRow));
  const endBox = rootBoxByKey.get(getGridKey(endColumn, endRow));

  if (!startBox || !endBox) {
    return;
  }

  const outputLinkPoint = getLinkPoint(startBox, endBox);
  const inputLinkPoint = getLinkPoint(endBox, startBox);
  const columnDistance = Math.abs(endColumn - startColumn);

  links.push({
    ...options,
    color: getColumnDistanceColor(columnDistance),
    inputLabelKey: getRootLabelKey(endColumn, endRow),
    inputLinkPoint: inputLinkPoint.linkPoint,
    inputLocation: inputLinkPoint.location,
    linkKey: `${getRootLabelKey(startColumn, startRow)}->${getRootLabelKey(endColumn, endRow)}`,
    outputLabelKey: getRootLabelKey(startColumn, startRow),
    outputLinkPoint: outputLinkPoint.linkPoint,
    outputLocation: outputLinkPoint.location,
    zoomLevel: DEMO_LINK_ZOOM_LEVEL,
    zoomRange: DEMO_LINK_ZOOM_RANGE,
  });
}

function getLinkPoint(box: DemoLayoutNodeBox, towardBox: DemoLayoutNodeBox): ResolvedLinkPoint {
  const center = getBoxCenter(box);
  const towardCenter = getBoxCenter(towardBox);
  const deltaX = towardCenter.x - center.x;
  const deltaY = towardCenter.y - center.y;
  const isSameColumn = box.column === towardBox.column;

  if (!isSameColumn) {
    return deltaX >= 0
      ? {
          linkPoint: 'right-center',
          location: {x: box.maxX, y: center.y},
        }
      : {
          linkPoint: 'left-center',
          location: {x: box.minX, y: center.y},
        };
  }

  return deltaY >= 0
    ? {
        linkPoint: 'top-center',
        location: {x: center.x, y: box.maxY},
      }
    : {
        linkPoint: 'bottom-center',
        location: {x: center.x, y: box.minY},
      };
}

function getBoxCenter(box: DemoLayoutNodeBox): LabelLocation {
  return {
    x: (box.minX + box.maxX) * 0.5,
    y: (box.minY + box.maxY) * 0.5,
  };
}

function getColumnDistanceColor(columnDistance: number): RgbaColor {
  const paletteIndex = Math.abs(columnDistance) % COLUMN_DISTANCE_LINK_COLORS.length;
  const color = COLUMN_DISTANCE_LINK_COLORS[paletteIndex] ?? COLUMN_DISTANCE_LINK_COLORS[0];

  return [color[0], color[1], color[2], color[3]];
}

function getGridKey(sourceColumnIndex: number, sourceRowIndex: number): string {
  return `${sourceColumnIndex}:${sourceRowIndex}`;
}

function getRootLabelKey(sourceColumnIndex: number, sourceRowIndex: number): string {
  return `${sourceColumnIndex + 1}:${sourceRowIndex + 1}:1`;
}
