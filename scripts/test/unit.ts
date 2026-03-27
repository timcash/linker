import assert from 'node:assert/strict';

import {Camera2D, type ViewportSize} from '../../src/camera';
import {
  layoutDemoEntries,
  type DemoLayoutEntry,
  type DemoLayoutNodeBox,
} from '../../src/data/demo-layout';
import {getDemoLinks} from '../../src/data/links';
import {DEMO_LABELS} from '../../src/data/labels';
import {
  MIN_ZOOM_OPACITY,
  MIN_ZOOM_SCALE,
  createZoomBand,
  getMaxVisibleZoom,
  getMinVisibleZoom,
  getZoomOpacity,
  getZoomScale,
  isZoomVisible,
} from '../../src/text/zoom';
import {
  DEMO_CHILD_LABEL_SIZE,
  DEMO_LABEL_COUNT,
  DEMO_ROOT_LABEL_COUNT,
  DEMO_ROOT_LABEL_SIZE,
  DEMO_ROWS_PER_SOURCE_COLUMN,
  DEMO_SOURCE_COLUMN_COUNT,
  FIRST_CHILD_LABEL,
  FIRST_ROOT_LABEL,
  LAST_CHILD_LABEL,
  LAST_ROOT_LABEL,
} from './types';

export function runCameraUnitTests(): void {
  const viewport: ViewportSize = {width: 800, height: 600};
  const camera = new Camera2D();

  const beforePan = camera.getSnapshot();
  camera.panByPixels(112, 56);
  const afterPan = camera.getSnapshot();

  assert.notEqual(afterPan.centerX, beforePan.centerX, 'Camera pan should change centerX.');
  assert.notEqual(afterPan.centerY, beforePan.centerY, 'Camera pan should change centerY.');

  const anchorScreenPoint = {x: 400, y: 300};
  const worldBeforeZoom = camera.screenToWorld(anchorScreenPoint, viewport);
  const zoomBefore = camera.zoom;

  camera.zoomAtScreenPoint(-120, anchorScreenPoint, viewport);

  const worldAfterZoom = camera.screenToWorld(anchorScreenPoint, viewport);

  assert.notEqual(camera.zoom, zoomBefore, 'Camera zoom should change after wheel zoom input.');
  assert.ok(
    Math.abs(worldAfterZoom.x - worldBeforeZoom.x) < 0.0001,
    'Zooming around a screen point should preserve world X at the anchor.',
  );
  assert.ok(
    Math.abs(worldAfterZoom.y - worldBeforeZoom.y) < 0.0001,
    'Zooming around a screen point should preserve world Y at the anchor.',
  );
}

export function runLayoutStrategyUnitTests(): void {
  const viewport: ViewportSize = {width: 1280, height: 800};
  const camera = new Camera2D();
  const visibleBounds = camera.getVisibleWorldBounds(viewport);
  const entries = createCanonicalDemoLayoutEntries();
  const placement = layoutDemoEntries(entries, 'flow-columns');
  const rootBoxes = placement.boxes.filter((box) => box.node === 'root');
  const rootColumns = new Set(rootBoxes.map((box) => box.column));
  const rootRows = new Set(rootBoxes.map((box) => box.row));
  const rowYByIndex = new Map<number, number>();

  assert.equal(
    placement.locations.length,
    entries.length,
    'The canonical 12x12 scene should place every root entry.',
  );
  assert.equal(
    placement.bandCount,
    DEMO_SOURCE_COLUMN_COUNT,
    'Flow Columns should preserve all 12 source columns.',
  );
  assert.equal(
    placement.columnCount,
    DEMO_SOURCE_COLUMN_COUNT,
    'Flow Columns should expose one compact root column per source column.',
  );
  assert.equal(
    rootBoxes.length,
    DEMO_ROOT_LABEL_COUNT,
    'Flow Columns should create one visible root box for each 12x12 grid cell.',
  );
  assert.equal(
    rootColumns.size,
    DEMO_SOURCE_COLUMN_COUNT,
    'Flow Columns should populate all 12 root columns.',
  );
  assert.equal(
    rootRows.size,
    DEMO_ROWS_PER_SOURCE_COLUMN,
    'Flow Columns should populate all 12 root rows.',
  );

  entries.forEach((entry, index) => {
    const existingY = rowYByIndex.get(entry.sourceRowIndex);
    const rootY = placement.locations[index].root.y;

    if (existingY === undefined) {
      rowYByIndex.set(entry.sourceRowIndex, rootY);
      return;
    }

    assert.equal(
      rootY,
      existingY,
      'Flow Columns should align each row to the same y position across every source column.',
    );
  });

  for (let index = 0; index < rootBoxes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < rootBoxes.length; otherIndex += 1) {
      assert.equal(
        boxesOverlap(rootBoxes[index], rootBoxes[otherIndex]),
        false,
        'The canonical 12x12 root grid should avoid overlapping root labels at zoom 0.',
      );
    }
  }

  for (const rootBox of rootBoxes) {
    assert.ok(
      rootBox.minX >= visibleBounds.minX && rootBox.maxX <= visibleBounds.maxX,
      'Every root label should fit inside the zoom 0 camera width.',
    );
    assert.ok(
      rootBox.minY >= visibleBounds.minY && rootBox.maxY <= visibleBounds.maxY,
      'Every root label should fit inside the zoom 0 camera height.',
    );
  }
}

export function runLinkPointUnitTests(): void {
  const entries = createCanonicalDemoLayoutEntries();
  const placement = layoutDemoEntries(entries, 'flow-columns');
  const links = getDemoLinks('flow-columns');
  const rootBoxByLabel = new Map<string, DemoLayoutNodeBox>();

  entries.forEach((entry, index) => {
    const rootBox = placement.boxes.find((box) => box.entryIndex === index && box.node === 'root');

    if (!rootBox) {
      return;
    }

    rootBoxByLabel.set(entry.nodes.root.text, rootBox);
  });

  const horizontalLink = links.find((link) => {
    const startBox = getRequiredRootBox(rootBoxByLabel, '1:2:1');
    const endBox = getRequiredRootBox(rootBoxByLabel, '2:2:1');

    return (
      Math.abs(link.start.x - startBox.maxX) < 0.0001 &&
      Math.abs(link.start.y - getBoxCenterY(startBox)) < 0.0001 &&
      Math.abs(link.end.x - endBox.minX) < 0.0001 &&
      Math.abs(link.end.y - getBoxCenterY(endBox)) < 0.0001
    );
  });

  assert.ok(
    horizontalLink,
    'Horizontal demo links should connect from the source right-center to the target left-center.',
  );

  const startVerticalBox = getRequiredRootBox(rootBoxByLabel, '3:1:1');
  const endVerticalBox = getRequiredRootBox(rootBoxByLabel, '3:2:1');
  const verticalLink = links.find((link) => {
    return (
      Math.abs(link.start.x - getBoxCenterX(startVerticalBox)) < 0.0001 &&
      Math.abs(link.start.y - startVerticalBox.minY) < 0.0001 &&
      Math.abs(link.end.x - getBoxCenterX(endVerticalBox)) < 0.0001 &&
      Math.abs(link.end.y - endVerticalBox.maxY) < 0.0001
    );
  });

  assert.ok(
    verticalLink,
    'Vertical demo links should connect from the lower label bottom-center to the upper label top-center.',
  );
}

export function runCanonicalLabelIdUnitTests(): void {
  assert.equal(
    DEMO_LABELS[0]?.text,
    FIRST_ROOT_LABEL,
    'The first generated label should be the first root id.',
  );
  assert.equal(
    DEMO_LABELS[DEMO_ROOT_LABEL_COUNT - 1]?.text,
    LAST_ROOT_LABEL,
    'The last level-1 label should be the last root id.',
  );
  assert.equal(
    DEMO_LABELS[DEMO_ROOT_LABEL_COUNT]?.text,
    FIRST_CHILD_LABEL,
    'The first level-2 label should be the first child id.',
  );
  assert.equal(
    DEMO_LABELS[DEMO_LABEL_COUNT - 1]?.text,
    LAST_CHILD_LABEL,
    'The last generated label should be the last child id.',
  );
}

function createCanonicalDemoLayoutEntries(): DemoLayoutEntry[] {
  const entries: DemoLayoutEntry[] = [];

  for (let rowIndex = 0; rowIndex < DEMO_ROWS_PER_SOURCE_COLUMN; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < DEMO_SOURCE_COLUMN_COUNT; columnIndex += 1) {
      const column = columnIndex + 1;
      const row = rowIndex + 1;
      const rootText = `${column}:${row}:1`;
      entries.push({
        nodes: {
          root: {text: rootText, size: DEMO_ROOT_LABEL_SIZE},
          child: {text: `${column}:${row}:2`, size: DEMO_CHILD_LABEL_SIZE},
        },
        sourceColumnIndex: columnIndex,
        sourceRowIndex: rowIndex,
      });
    }
  }

  return entries;
}

function getRequiredRootBox(
  rootBoxByLabel: Map<string, DemoLayoutNodeBox>,
  label: string,
): DemoLayoutNodeBox {
  const box = rootBoxByLabel.get(label);

  assert.ok(box, `Expected a root box for ${label}.`);
  return box;
}

function getBoxCenterX(box: DemoLayoutNodeBox): number {
  return (box.minX + box.maxX) * 0.5;
}

function getBoxCenterY(box: DemoLayoutNodeBox): number {
  return (box.minY + box.maxY) * 0.5;
}

export function runZoomBandUnitTests(): void {
  const detailBand = createZoomBand(3.5, 4.5);

  assert.equal(detailBand.zoomLevel, 4, 'Zoom bands should store the focal zoom midpoint.');
  assert.equal(detailBand.zoomRange, 0.5, 'Zoom bands should store half of the visible zoom span.');
  assert.equal(
    getMinVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange),
    3.5,
    'Zoom bands should expose the lower visible bound.',
  );
  assert.equal(
    getMaxVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange),
    4.5,
    'Zoom bands should expose the upper visible bound.',
  );
  assert.equal(
    isZoomVisible(3.49, detailBand.zoomLevel, detailBand.zoomRange),
    false,
    'Zoom bands should keep labels hidden before the reveal threshold.',
  );
  assert.equal(
    isZoomVisible(3.5, detailBand.zoomLevel, detailBand.zoomRange),
    true,
    'Zoom bands should reveal labels at the threshold.',
  );
  assert.equal(
    isZoomVisible(4.5, detailBand.zoomLevel, detailBand.zoomRange),
    true,
    'Zoom bands should remain visible through the upper threshold.',
  );
  assert.equal(
    isZoomVisible(4.51, detailBand.zoomLevel, detailBand.zoomRange),
    false,
    'Zoom bands should hide labels once the zoom passes the upper threshold.',
  );
  assert.equal(
    getZoomScale(3.5, detailBand.zoomLevel, detailBand.zoomRange),
    MIN_ZOOM_SCALE,
    'Zoom-band scaling should start at the minimum reveal scale.',
  );
  assert.equal(
    getZoomScale(4, detailBand.zoomLevel, detailBand.zoomRange),
    1,
    'Zoom-band scaling should reach full size at the focal zoom.',
  );
  assert.equal(
    getZoomOpacity(3.5, detailBand.zoomLevel, detailBand.zoomRange),
    MIN_ZOOM_OPACITY,
    'Zoom-band opacity should start at the minimum fade value at the reveal edge.',
  );
  assert.equal(
    getZoomOpacity(4, detailBand.zoomLevel, detailBand.zoomRange),
    1,
    'Zoom-band opacity should reach full strength at the focal zoom.',
  );
  assert.ok(
    getZoomScale(3.75, detailBand.zoomLevel, detailBand.zoomRange) > MIN_ZOOM_SCALE &&
      getZoomScale(3.75, detailBand.zoomLevel, detailBand.zoomRange) < 1,
    'Zoom-band scaling should interpolate between the reveal edge and the focal zoom.',
  );
  assert.ok(
    getZoomOpacity(3.75, detailBand.zoomLevel, detailBand.zoomRange) > MIN_ZOOM_OPACITY &&
      getZoomOpacity(3.75, detailBand.zoomLevel, detailBand.zoomRange) < 1,
    'Zoom-band opacity should interpolate between the reveal edge and the focal zoom.',
  );
}

function boxesOverlap(left: DemoLayoutNodeBox, right: DemoLayoutNodeBox): boolean {
  const epsilon = 0.0001;

  return (
    left.minX < right.maxX - epsilon &&
    left.maxX > right.minX + epsilon &&
    left.minY < right.maxY - epsilon &&
    left.maxY > right.minY + epsilon
  );
}
