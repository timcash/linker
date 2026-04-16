import {cloneStageScene, type StageScene} from './scene-model';
import type {LinkDefinition, LinkPoint} from './line/types';
import {getLayerZoomLevel} from './layer-grid';
import {
  buildLabelCellKey,
  buildLabelKey,
  getCellKeyFromLabelKey,
  getRootLabelKey,
  parseLabelKey,
} from './label-key';
import type {
  LabelDefinition,
  LabelLocation,
  RgbaColor,
} from './text/types';

export type StageEditorDirection =
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up';

export type StageEditorCursorKind = 'ghost' | 'label';

export type StageEditorCursor = {
  column: number;
  key: string;
  kind: StageEditorCursorKind;
  layer: number;
  row: number;
  workplaneId: string;
};

export type StageEditorGhost = StageEditorCursor & {
  direction: StageEditorDirection;
};

export type StageEditorState = {
  cursor: StageEditorCursor;
  selectedLabelKeys: string[];
};

export type StageEditorSceneMutationResult = {
  changed: boolean;
  editorState: StageEditorState;
  scene: StageScene;
};

type RootLabelSummary = {
  color?: RgbaColor;
  column: number;
  label: LabelDefinition;
  row: number;
};

type LabelLayerTemplate = {
  color?: RgbaColor;
  offsetX: number;
  offsetY: number;
  size: number;
  zoomLevel: number;
  zoomRange: number;
};

const DEFAULT_EDITOR_LAYER_COUNT = 5;
const DEFAULT_EDITOR_LABEL_COLOR: RgbaColor = [1, 1, 1, 1];
const DEFAULT_EDITOR_LABEL_SIZE = 0.34;
const DEFAULT_EDITOR_LINK_COLOR: RgbaColor = [1, 1, 1, 0.72];
const DEFAULT_EDITOR_LINK_LINE_WIDTH = 2.6;
const DEFAULT_EDITOR_LINK_ZOOM_LEVEL = 0;
const DEFAULT_EDITOR_LINK_ZOOM_RANGE = 8;
const DEFAULT_EDITOR_ROOT_ZOOM_LEVEL = 0;
const DEFAULT_EDITOR_ROOT_ZOOM_RANGE = 2.4;
const DEFAULT_EDITOR_DETAIL_ZOOM_RANGE = 1;
const DEFAULT_EDITOR_X_STEP = 3.8;
const DEFAULT_EDITOR_Y_STEP = 3.2;

export function createStageEditorState(
  scene: StageScene,
  requestedLabelKey?: string | null,
): StageEditorState {
  const requestedLabel = findSceneLabelByKey(scene, requestedLabelKey);

  if (requestedLabel?.navigation) {
    return {
      cursor: toLabelCursor(requestedLabel.navigation.key),
      selectedLabelKeys: [],
    };
  }

  const firstLabel = getFirstNavigableLabel(scene);

  return {
    cursor: firstLabel?.navigation
      ? toLabelCursor(firstLabel.navigation.key)
      : createGhostCursor(scene.workplaneId, 1, 1, 1),
    selectedLabelKeys: [],
  };
}

export function relayoutStageEditorState(
  previousState: StageEditorState | null,
  scene: StageScene,
  requestedLabelKey?: string | null,
): StageEditorState {
  const requestedLabel = findSceneLabelByKey(scene, requestedLabelKey);
  const selectedLabelKeys =
    previousState?.selectedLabelKeys.filter((labelKey) => findSceneLabelByKey(scene, labelKey)) ??
    [];

  if (requestedLabel?.navigation) {
    return {
      cursor: toLabelCursor(requestedLabel.navigation.key),
      selectedLabelKeys,
    };
  }

  if (previousState?.cursor) {
    const {column, layer, row} = previousState.cursor;
    const currentLabel = findSceneLabelByCoordinate(scene, column, row, layer);

    return {
      cursor: currentLabel?.navigation
        ? toLabelCursor(currentLabel.navigation.key)
        : createGhostCursor(scene.workplaneId, column, row, layer),
      selectedLabelKeys,
    };
  }

  const firstLabel = getFirstNavigableLabel(scene);

  return {
    cursor: firstLabel?.navigation
      ? toLabelCursor(firstLabel.navigation.key)
      : createGhostCursor(scene.workplaneId, 1, 1, 1),
    selectedLabelKeys,
  };
}

export function focusStageEditorLabel(
  state: StageEditorState,
  scene: StageScene,
  labelKey: string,
): StageEditorState {
  const label = findSceneLabelByKey(scene, labelKey);

  return label?.navigation
    ? {
        ...state,
        cursor: toLabelCursor(label.navigation.key),
      }
    : state;
}

export function moveStageEditorCursor(
  state: StageEditorState,
  scene: StageScene,
  direction: StageEditorDirection,
): StageEditorState {
  const nextCoordinate = getOffsetCoordinate(state.cursor, direction);

  if (
    nextCoordinate.column === state.cursor.column &&
    nextCoordinate.row === state.cursor.row &&
    nextCoordinate.layer === state.cursor.layer
  ) {
    return state;
  }

  const targetLabel = findSceneLabelByCoordinate(
    scene,
    nextCoordinate.column,
    nextCoordinate.row,
    nextCoordinate.layer,
  );

  return {
    ...state,
    cursor: targetLabel?.navigation
      ? toLabelCursor(targetLabel.navigation.key)
      : createGhostCursor(
          scene.workplaneId,
          nextCoordinate.column,
          nextCoordinate.row,
          nextCoordinate.layer,
        ),
  };
}

export function toggleStageEditorSelection(
  state: StageEditorState,
  scene: StageScene,
): StageEditorState {
  const labelKey = getStageEditorFocusedLabelKey(state, scene);

  if (!labelKey) {
    return state;
  }

  return state.selectedLabelKeys.includes(labelKey)
    ? {
        ...state,
        selectedLabelKeys: state.selectedLabelKeys.filter(
          (selectedLabelKey) => selectedLabelKey !== labelKey,
        ),
      }
    : {
        ...state,
        selectedLabelKeys: [...state.selectedLabelKeys, labelKey],
      };
}

export function clearStageEditorSelection(state: StageEditorState): StageEditorState {
  if (state.selectedLabelKeys.length === 0) {
    return state;
  }

  return {
    ...state,
    selectedLabelKeys: [],
  };
}

export function getStageEditorFocusedLabel(
  state: StageEditorState | null,
  scene: StageScene,
): LabelDefinition | null {
  if (!state) {
    return null;
  }

  return state.cursor.kind === 'label'
    ? findSceneLabelByKey(scene, state.cursor.key)
    : null;
}

export function getStageEditorFocusedLabelKey(
  state: StageEditorState | null,
  scene: StageScene,
): string | null {
  return getStageEditorFocusedLabel(state, scene)?.navigation?.key ?? null;
}

export function getStageEditorSelectionRanks(
  state: StageEditorState,
): Map<string, number> {
  return new Map(
    state.selectedLabelKeys.map((labelKey, index) => [labelKey, index + 1]),
  );
}

export function getStageEditorGhosts(
  scene: StageScene,
  state: StageEditorState,
): StageEditorGhost[] {
  return [
    createGhostForDirection(scene, state.cursor, 'pan-up'),
    createGhostForDirection(scene, state.cursor, 'pan-right'),
    createGhostForDirection(scene, state.cursor, 'pan-down'),
    createGhostForDirection(scene, state.cursor, 'pan-left'),
  ].filter((ghost): ghost is StageEditorGhost => ghost !== null);
}

export function getStageEditorCursorLocation(
  scene: StageScene,
  cursor: StageEditorCursor,
): LabelLocation {
  const focusedLabel =
    cursor.kind === 'label' ? findSceneLabelByKey(scene, cursor.key) : null;

  if (focusedLabel) {
    return {
      x: focusedLabel.location.x,
      y: focusedLabel.location.y,
      z: focusedLabel.location.z,
    };
  }

  const templates = buildLayerTemplates(scene, getSceneLayerCount(scene));
  const template = templates.get(cursor.layer) ?? createDefaultLayerTemplate(cursor.layer);
  const baseLocation = estimateRootLabelLocation(scene, cursor.column, cursor.row);

  return {
    x: baseLocation.x + template.offsetX,
    y: baseLocation.y + template.offsetY,
  };
}

export function getSceneLayerCount(scene: StageScene): number {
  let layerCount = 0;

  for (const label of scene.labels) {
    if (label.navigation) {
      layerCount = Math.max(layerCount, label.navigation.layer);
    }
  }

  return Math.max(DEFAULT_EDITOR_LAYER_COUNT, layerCount || 0);
}

export function addLabelAtStageEditorCursor(
  scene: StageScene,
  state: StageEditorState,
): StageEditorSceneMutationResult {
  if (state.cursor.kind !== 'ghost') {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  const nextScene = cloneStageScene(scene);
  const layerCount = getSceneLayerCount(nextScene);
  const templates = buildLayerTemplates(nextScene, layerCount);
  const baseLocation = estimateRootLabelLocation(
    nextScene,
    state.cursor.column,
    state.cursor.row,
  );
  const baseColor = estimateNewLabelColor(
    nextScene,
    state.cursor.column,
    state.cursor.row,
  );
  const newLabels: LabelDefinition[] = [];

  for (let layer = 1; layer <= layerCount; layer += 1) {
    const template = templates.get(layer) ?? createDefaultLayerTemplate(layer);
    const navigationKey = buildLabelKey(
      state.cursor.workplaneId,
      layer,
      state.cursor.row,
      state.cursor.column,
    );

    newLabels.push({
      color: [...(template.color ?? baseColor)],
      inputLinkKeys: [],
      location: {
        x: baseLocation.x + template.offsetX,
        y: baseLocation.y + template.offsetY,
      },
      navigation: {
        column: state.cursor.column,
        key: navigationKey,
        layer,
        row: state.cursor.row,
        workplaneId: state.cursor.workplaneId,
      },
      outputLinkKeys: [],
      size: template.size,
      text: navigationKey,
      zoomLevel: template.zoomLevel,
      zoomRange: template.zoomRange,
    });
  }

  nextScene.labels.push(...newLabels);
  sortSceneLabels(nextScene.labels);
  rebuildSceneLinkKeys(nextScene);

  const focusedLabelKey = buildLabelKey(
    state.cursor.workplaneId,
    state.cursor.layer,
    state.cursor.row,
    state.cursor.column,
  );
  const nextEditorState = focusStageEditorLabel(
    state,
    nextScene,
    focusedLabelKey,
  );

  return {
    changed: true,
    editorState: nextEditorState,
    scene: nextScene,
  };
}

export function removeLabelAtStageEditorCursor(
  scene: StageScene,
  state: StageEditorState,
): StageEditorSceneMutationResult {
  const focusedLabel = getStageEditorFocusedLabel(state, scene);

  if (!focusedLabel?.navigation) {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  const cellKey = getCellKeyFromLabelKey(focusedLabel.navigation.key);
  const rootLabelKey = getRootLabelKey(focusedLabel.navigation.key);
  const nextScene = cloneStageScene(scene);
  const nextLabels = nextScene.labels.filter(
    (label) => getCellKeyFromLabelKey(label.navigation?.key) !== cellKey,
  );
  const nextLinks = nextScene.links.filter(
    (link) =>
      getRootLabelKey(link.outputLabelKey) !== rootLabelKey &&
      getRootLabelKey(link.inputLabelKey) !== rootLabelKey,
  );

  if (
    nextLabels.length === nextScene.labels.length &&
    nextLinks.length === nextScene.links.length
  ) {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  nextScene.labels = nextLabels;
  nextScene.links = nextLinks;
  rebuildSceneLinkKeys(nextScene);

  return {
    changed: true,
    editorState: {
      cursor: createGhostCursor(
        focusedLabel.navigation.workplaneId,
        focusedLabel.navigation.column,
        focusedLabel.navigation.row,
        focusedLabel.navigation.layer,
      ),
      selectedLabelKeys: state.selectedLabelKeys.filter(
        (labelKey) => getCellKeyFromLabelKey(labelKey) !== cellKey,
      ),
    },
    scene: nextScene,
  };
}

export function linkStageEditorSelection(
  scene: StageScene,
  state: StageEditorState,
): StageEditorSceneMutationResult {
  const orderedRootLabelKeys = getOrderedSelectionRootKeys(state.selectedLabelKeys);

  if (orderedRootLabelKeys.length < 2) {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  const nextScene = cloneStageScene(scene);
  let changed = false;

  for (let index = 0; index < orderedRootLabelKeys.length - 1; index += 1) {
    const outputLabelKey = orderedRootLabelKeys[index];
    const inputLabelKey = orderedRootLabelKeys[index + 1];

    if (!outputLabelKey || !inputLabelKey) {
      continue;
    }

    if (
      nextScene.links.some(
        (link) =>
          getRootLabelKey(link.outputLabelKey) === outputLabelKey &&
          getRootLabelKey(link.inputLabelKey) === inputLabelKey,
      )
    ) {
      continue;
    }

    const nextLink = createDirectedSceneLink(
      nextScene,
      outputLabelKey,
      inputLabelKey,
    );

    if (!nextLink) {
      continue;
    }

    nextScene.links.push(nextLink);
    changed = true;
  }

  if (!changed) {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  rebuildSceneLinkKeys(nextScene);

  return {
    changed: true,
    editorState: state,
    scene: nextScene,
  };
}

export function removeStageEditorLinks(
  scene: StageScene,
  state: StageEditorState,
): StageEditorSceneMutationResult {
  const orderedRootLabelKeys = getOrderedSelectionRootKeys(state.selectedLabelKeys);
  const focusedLabelKey = getStageEditorFocusedLabelKey(state, scene);
  const focusedRootLabelKey = getRootLabelKey(focusedLabelKey);
  const nextScene = cloneStageScene(scene);
  let nextLinks = nextScene.links;

  if (orderedRootLabelKeys.length >= 2) {
    const removablePairs = new Set<string>();

    for (let index = 0; index < orderedRootLabelKeys.length - 1; index += 1) {
      const outputLabelKey = orderedRootLabelKeys[index];
      const inputLabelKey = orderedRootLabelKeys[index + 1];

      if (!outputLabelKey || !inputLabelKey) {
        continue;
      }

      removablePairs.add(`${outputLabelKey}->${inputLabelKey}`);
      removablePairs.add(`${inputLabelKey}->${outputLabelKey}`);
    }

    nextLinks = nextLinks.filter(
      (link) =>
        !removablePairs.has(
          `${getRootLabelKey(link.outputLabelKey)}->${getRootLabelKey(link.inputLabelKey)}`,
        ),
    );
  } else if (focusedRootLabelKey) {
    nextLinks = nextLinks.filter(
      (link) =>
        getRootLabelKey(link.outputLabelKey) !== focusedRootLabelKey &&
        getRootLabelKey(link.inputLabelKey) !== focusedRootLabelKey,
    );
  }

  if (nextLinks.length === nextScene.links.length) {
    return {
      changed: false,
      editorState: state,
      scene,
    };
  }

  nextScene.links = nextLinks;
  rebuildSceneLinkKeys(nextScene);

  return {
    changed: true,
    editorState: state,
    scene: nextScene,
  };
}

export function canLinkStageEditorSelection(state: StageEditorState): boolean {
  return getOrderedSelectionRootKeys(state.selectedLabelKeys).length >= 2;
}

export function canRemoveStageEditorLinks(
  scene: StageScene,
  state: StageEditorState,
): boolean {
  const orderedRootLabelKeys = getOrderedSelectionRootKeys(state.selectedLabelKeys);

  if (orderedRootLabelKeys.length >= 2) {
    return orderedRootLabelKeys.some((outputLabelKey, index) => {
      const inputLabelKey = orderedRootLabelKeys[index + 1];

      return Boolean(
        outputLabelKey &&
          inputLabelKey &&
          scene.links.some(
            (link) =>
              (
                getRootLabelKey(link.outputLabelKey) === outputLabelKey &&
                getRootLabelKey(link.inputLabelKey) === inputLabelKey
              ) ||
              (
                getRootLabelKey(link.outputLabelKey) === inputLabelKey &&
                getRootLabelKey(link.inputLabelKey) === outputLabelKey
              ),
          ),
      );
    });
  }

  const focusedRootLabelKey = getRootLabelKey(
    getStageEditorFocusedLabelKey(state, scene),
  );

  return Boolean(
    focusedRootLabelKey &&
      scene.links.some(
        (link) =>
          getRootLabelKey(link.outputLabelKey) === focusedRootLabelKey ||
          getRootLabelKey(link.inputLabelKey) === focusedRootLabelKey,
      ),
  );
}

export function getStageEditorFocusedCellKey(
  state: StageEditorState,
): string {
  return buildLabelCellKey(
    state.cursor.workplaneId,
    state.cursor.row,
    state.cursor.column,
  );
}

function findSceneLabelByKey(
  scene: StageScene,
  labelKey: string | null | undefined,
): LabelDefinition | null {
  if (!labelKey) {
    return null;
  }

  return (
    scene.labels.find((label) => label.navigation?.key === labelKey) ?? null
  );
}

function findSceneLabelByCoordinate(
  scene: StageScene,
  column: number,
  row: number,
  layer: number,
): LabelDefinition | null {
  return (
    scene.labels.find(
      (label) =>
        label.navigation?.column === column &&
        label.navigation.row === row &&
        label.navigation.layer === layer,
    ) ?? null
  );
}

function getFirstNavigableLabel(scene: StageScene): LabelDefinition | null {
  return scene.labels.find((label) => label.navigation) ?? null;
}

function toLabelCursor(labelKey: string): StageEditorCursor {
  const {column, layer, row, workplaneId} = parseLabelKey(labelKey);

  return {
    column,
    key: labelKey,
    kind: 'label',
    layer,
    row,
    workplaneId,
  };
}

function createGhostCursor(
  workplaneId: string,
  column: number,
  row: number,
  layer: number,
): StageEditorCursor {
  return {
    column,
    key: buildLabelKey(workplaneId, layer, row, column),
    kind: 'ghost',
    layer,
    row,
    workplaneId,
  };
}

function createGhostForDirection(
  scene: StageScene,
  cursor: StageEditorCursor,
  direction: StageEditorDirection,
): StageEditorGhost | null {
  let nextCoordinate = getOffsetCoordinate(cursor, direction);

  if (
    nextCoordinate.column === cursor.column &&
    nextCoordinate.row === cursor.row &&
    nextCoordinate.layer === cursor.layer
  ) {
    return null;
  }

  while (true) {
    if (
      !findSceneLabelByCoordinate(
        scene,
        nextCoordinate.column,
        nextCoordinate.row,
        nextCoordinate.layer,
      )
    ) {
      return {
        ...createGhostCursor(
          cursor.workplaneId,
          nextCoordinate.column,
          nextCoordinate.row,
          nextCoordinate.layer,
        ),
        direction,
      };
    }

    const offsetCursor: StageEditorCursor = {
      ...cursor,
      column: nextCoordinate.column,
      key: buildLabelKey(
        cursor.workplaneId,
        nextCoordinate.layer,
        nextCoordinate.row,
        nextCoordinate.column,
      ),
      row: nextCoordinate.row,
    };

    nextCoordinate = getOffsetCoordinate(offsetCursor, direction);

    if (
      nextCoordinate.column === offsetCursor.column &&
      nextCoordinate.row === offsetCursor.row &&
      nextCoordinate.layer === offsetCursor.layer
    ) {
      return null;
    }
  }

  return null;
}

function getOffsetCoordinate(
  cursor: StageEditorCursor,
  direction: StageEditorDirection,
): {column: number; layer: number; row: number} {
  switch (direction) {
    case 'pan-down':
      return {
        column: cursor.column,
        layer: cursor.layer,
        row: cursor.row + 1,
      };
    case 'pan-left':
      return {
        column: cursor.column - 1,
        layer: cursor.layer,
        row: cursor.row,
      };
    case 'pan-right':
      return {
        column: cursor.column + 1,
        layer: cursor.layer,
        row: cursor.row,
      };
    case 'pan-up':
    default:
      return {
        column: cursor.column,
        layer: cursor.layer,
        row: cursor.row - 1,
      };
  }
}

function getOrderedSelectionRootKeys(selectedLabelKeys: string[]): string[] {
  const seen = new Set<string>();
  const orderedRootKeys: string[] = [];

  for (const labelKey of selectedLabelKeys) {
    const rootLabelKey = getRootLabelKey(labelKey);

    if (seen.has(rootLabelKey)) {
      continue;
    }

    seen.add(rootLabelKey);
    orderedRootKeys.push(rootLabelKey);
  }

  return orderedRootKeys;
}

function buildLayerTemplates(
  scene: StageScene,
  layerCount: number,
): Map<number, LabelLayerTemplate> {
  const templates = new Map<number, LabelLayerTemplate>();
  const rootLabelsByCellKey = new Map<string, LabelDefinition>();

  for (const label of scene.labels) {
    if (label.navigation?.layer === 1) {
      rootLabelsByCellKey.set(getCellKeyFromLabelKey(label.navigation.key), label);
    }
  }

  for (const label of scene.labels) {
    const layer = label.navigation?.layer;

    if (!layer || templates.has(layer)) {
      continue;
    }

    const rootLabel = rootLabelsByCellKey.get(
      getCellKeyFromLabelKey(label.navigation?.key),
    );

    templates.set(layer, {
      color: label.color ? [...label.color] : undefined,
      offsetX: rootLabel ? label.location.x - rootLabel.location.x : 0,
      offsetY: rootLabel ? label.location.y - rootLabel.location.y : 0,
      size: label.size,
      zoomLevel: label.zoomLevel,
      zoomRange: label.zoomRange,
    });
  }

  for (let layer = 1; layer <= layerCount; layer += 1) {
    if (!templates.has(layer)) {
      templates.set(layer, createDefaultLayerTemplate(layer));
    }
  }

  return templates;
}

function createDefaultLayerTemplate(layer: number): LabelLayerTemplate {
  if (layer === 1) {
    return {
      color: [...DEFAULT_EDITOR_LABEL_COLOR],
      offsetX: 0,
      offsetY: 0,
      size: DEFAULT_EDITOR_LABEL_SIZE,
      zoomLevel: DEFAULT_EDITOR_ROOT_ZOOM_LEVEL,
      zoomRange: DEFAULT_EDITOR_ROOT_ZOOM_RANGE,
    };
  }

  return {
    color: [...DEFAULT_EDITOR_LABEL_COLOR],
    offsetX: 0,
    offsetY: 0,
    size: Math.max(0.24, DEFAULT_EDITOR_LABEL_SIZE - (layer - 1) * 0.016),
    zoomLevel: getLayerZoomLevel(DEFAULT_EDITOR_ROOT_ZOOM_LEVEL, layer),
    zoomRange: DEFAULT_EDITOR_DETAIL_ZOOM_RANGE,
  };
}

function estimateRootLabelLocation(
  scene: StageScene,
  targetColumn: number,
  targetRow: number,
): LabelLocation {
  const rootLabels = getSceneRootLabels(scene);
  const xStep = estimateAverageAxisStep(rootLabels, 'x');
  const yStep = estimateAverageAxisStep(rootLabels, 'y');
  const rowSamples = rootLabels
    .filter((label) => label.row === targetRow)
    .map((label) => ({index: label.column, value: label.label.location.x}));
  const columnSamples = rootLabels
    .filter((label) => label.column === targetColumn)
    .map((label) => ({index: label.row, value: label.label.location.y}));
  const fallbackRootLabel = findNearestRootLabel(rootLabels, targetColumn, targetRow);

  return {
    x: estimateAxisValue(
      rowSamples,
      targetColumn,
      xStep,
      fallbackRootLabel
        ? fallbackRootLabel.label.location.x + (targetColumn - fallbackRootLabel.column) * xStep
        : 0,
    ),
    y: estimateAxisValue(
      columnSamples,
      targetRow,
      yStep,
      fallbackRootLabel
        ? fallbackRootLabel.label.location.y + (targetRow - fallbackRootLabel.row) * yStep
        : 0,
    ),
  };
}

function getSceneRootLabels(scene: StageScene): RootLabelSummary[] {
  return scene.labels
    .filter((label) => label.navigation?.layer === 1)
    .map((label) => ({
      color: label.color ? [...label.color] : undefined,
      column: label.navigation?.column ?? 1,
      label,
      row: label.navigation?.row ?? 1,
    }));
}

function estimateAverageAxisStep(
  rootLabels: RootLabelSummary[],
  axis: 'x' | 'y',
): number {
  const deltas: number[] = [];

  if (axis === 'x') {
    const labelsByRow = new Map<number, RootLabelSummary[]>();

    for (const rootLabel of rootLabels) {
      const rowLabels = labelsByRow.get(rootLabel.row);

      if (rowLabels) {
        rowLabels.push(rootLabel);
      } else {
        labelsByRow.set(rootLabel.row, [rootLabel]);
      }
    }

    for (const rowLabels of labelsByRow.values()) {
      rowLabels.sort((left, right) => left.column - right.column);

      for (let index = 1; index < rowLabels.length; index += 1) {
        const previousLabel = rowLabels[index - 1];
        const nextLabel = rowLabels[index];
        const columnDelta = Math.max(1, nextLabel.column - previousLabel.column);
        deltas.push(
          (nextLabel.label.location.x - previousLabel.label.location.x) / columnDelta,
        );
      }
    }

    return averageOrFallback(deltas, DEFAULT_EDITOR_X_STEP);
  }

  const labelsByColumn = new Map<number, RootLabelSummary[]>();

  for (const rootLabel of rootLabels) {
    const columnLabels = labelsByColumn.get(rootLabel.column);

    if (columnLabels) {
      columnLabels.push(rootLabel);
    } else {
      labelsByColumn.set(rootLabel.column, [rootLabel]);
    }
  }

  for (const columnLabels of labelsByColumn.values()) {
    columnLabels.sort((left, right) => left.row - right.row);

    for (let index = 1; index < columnLabels.length; index += 1) {
      const previousLabel = columnLabels[index - 1];
      const nextLabel = columnLabels[index];
      const rowDelta = Math.max(1, nextLabel.row - previousLabel.row);
      deltas.push(
        (nextLabel.label.location.y - previousLabel.label.location.y) / rowDelta,
      );
    }
  }

  return averageOrFallback(deltas, DEFAULT_EDITOR_Y_STEP);
}

function estimateAxisValue(
  samples: Array<{index: number; value: number}>,
  targetIndex: number,
  fallbackStep: number,
  fallbackValue: number,
): number {
  if (samples.length === 0) {
    return fallbackValue;
  }

  const sortedSamples = [...samples].sort((left, right) => left.index - right.index);
  const exactSample = sortedSamples.find((sample) => sample.index === targetIndex);

  if (exactSample) {
    return exactSample.value;
  }

  let previousSample: {index: number; value: number} | null = null;
  let nextSample: {index: number; value: number} | null = null;

  for (const sample of sortedSamples) {
    if (sample.index < targetIndex) {
      previousSample = sample;
      continue;
    }

    if (sample.index > targetIndex) {
      nextSample = sample;
      break;
    }
  }

  if (previousSample && nextSample) {
    const span = Math.max(1, nextSample.index - previousSample.index);
    const t = (targetIndex - previousSample.index) / span;

    return previousSample.value + (nextSample.value - previousSample.value) * t;
  }

  if (previousSample) {
    const beforePrevious =
      sortedSamples.filter((sample) => sample.index < previousSample.index).at(-1) ??
      null;
    const step =
      beforePrevious === null
        ? fallbackStep
        : (previousSample.value - beforePrevious.value) /
          Math.max(1, previousSample.index - beforePrevious.index);

    return previousSample.value + (targetIndex - previousSample.index) * step;
  }

  if (nextSample) {
    const afterNext =
      sortedSamples.find((sample) => sample.index > nextSample.index) ?? null;
    const step =
      afterNext === null
        ? fallbackStep
        : (afterNext.value - nextSample.value) /
          Math.max(1, afterNext.index - nextSample.index);

    return nextSample.value - (nextSample.index - targetIndex) * step;
  }

  return fallbackValue;
}

function findNearestRootLabel(
  rootLabels: RootLabelSummary[],
  targetColumn: number,
  targetRow: number,
): RootLabelSummary | null {
  let nearestLabel: RootLabelSummary | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const rootLabel of rootLabels) {
    const distance = Math.hypot(
      rootLabel.column - targetColumn,
      rootLabel.row - targetRow,
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLabel = rootLabel;
    }
  }

  return nearestLabel;
}

function estimateNewLabelColor(
  scene: StageScene,
  targetColumn: number,
  targetRow: number,
): RgbaColor {
  const rootLabels = getSceneRootLabels(scene).filter(
    (rootLabel) =>
      Math.abs(rootLabel.column - targetColumn) <= 1 &&
      Math.abs(rootLabel.row - targetRow) <= 1,
  );

  if (rootLabels.length === 0) {
    return [...DEFAULT_EDITOR_LABEL_COLOR];
  }

  const totals = rootLabels.reduce(
    (accumulator, rootLabel) => {
      const color = rootLabel.color ?? DEFAULT_EDITOR_LABEL_COLOR;

      return {
        alpha: accumulator.alpha + color[3],
        blue: accumulator.blue + color[2],
        green: accumulator.green + color[1],
        red: accumulator.red + color[0],
      };
    },
    {alpha: 0, blue: 0, green: 0, red: 0},
  );
  const count = rootLabels.length;

  return [
    totals.red / count,
    totals.green / count,
    totals.blue / count,
    totals.alpha / count,
  ];
}

function createDirectedSceneLink(
  scene: StageScene,
  outputRootLabelKey: string,
  inputRootLabelKey: string,
): LinkDefinition | null {
  const outputLabel = findSceneLabelByKey(scene, outputRootLabelKey);
  const inputLabel = findSceneLabelByKey(scene, inputRootLabelKey);

  if (!outputLabel || !inputLabel) {
    return null;
  }

  const linkPoints = resolveLinkPoints(outputLabel.location, inputLabel.location);

  return {
    bendDirection: inputLabel.location.y >= outputLabel.location.y ? 1 : -1,
    color: createLinkColor(outputLabel.color, inputLabel.color),
    curveBias: 0.2,
    curveDepth: 0.14,
    curveLift: 0.08,
    inputLabelKey: inputRootLabelKey,
    inputLinkPoint: linkPoints.inputLinkPoint,
    inputLocation: {...inputLabel.location},
    linkKey: `${scene.labelSetPreset}:${outputRootLabelKey}->${inputRootLabelKey}`,
    lineWidth: DEFAULT_EDITOR_LINK_LINE_WIDTH,
    outputLabelKey: outputRootLabelKey,
    outputLinkPoint: linkPoints.outputLinkPoint,
    outputLocation: {...outputLabel.location},
    zoomLevel: DEFAULT_EDITOR_LINK_ZOOM_LEVEL,
    zoomRange: DEFAULT_EDITOR_LINK_ZOOM_RANGE,
  };
}

function createLinkColor(
  outputColor: RgbaColor | undefined,
  inputColor: RgbaColor | undefined,
): RgbaColor {
  const left = outputColor ?? DEFAULT_EDITOR_LABEL_COLOR;
  const right = inputColor ?? DEFAULT_EDITOR_LABEL_COLOR;

  return [
    (left[0] + right[0]) * 0.5,
    (left[1] + right[1]) * 0.5,
    (left[2] + right[2]) * 0.5,
    DEFAULT_EDITOR_LINK_COLOR[3],
  ];
}

function resolveLinkPoints(
  outputLocation: LabelLocation,
  inputLocation: LabelLocation,
): {inputLinkPoint: LinkPoint; outputLinkPoint: LinkPoint} {
  const deltaX = inputLocation.x - outputLocation.x;
  const deltaY = inputLocation.y - outputLocation.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? {
          inputLinkPoint: 'left-center',
          outputLinkPoint: 'right-center',
        }
      : {
          inputLinkPoint: 'right-center',
          outputLinkPoint: 'left-center',
        };
  }

  return deltaY >= 0
    ? {
        inputLinkPoint: 'bottom-center',
        outputLinkPoint: 'top-center',
      }
    : {
        inputLinkPoint: 'top-center',
        outputLinkPoint: 'bottom-center',
      };
}

function rebuildSceneLinkKeys(scene: StageScene): void {
  const labelsByCellKey = new Map<string, LabelDefinition[]>();

  for (const label of scene.labels) {
    label.inputLinkKeys.length = 0;
    label.outputLinkKeys.length = 0;

    const cellKey = getCellKeyFromLabelKey(label.navigation?.key);
    const cellLabels = labelsByCellKey.get(cellKey);

    if (cellLabels) {
      cellLabels.push(label);
    } else {
      labelsByCellKey.set(cellKey, [label]);
    }
  }

  for (const link of scene.links) {
    const outputCellLabels =
      labelsByCellKey.get(getCellKeyFromLabelKey(link.outputLabelKey)) ?? [];
    const inputCellLabels =
      labelsByCellKey.get(getCellKeyFromLabelKey(link.inputLabelKey)) ?? [];

    for (const label of outputCellLabels) {
      label.outputLinkKeys.push(link.linkKey);
    }

    for (const label of inputCellLabels) {
      label.inputLinkKeys.push(link.linkKey);
    }
  }
}

function sortSceneLabels(labels: LabelDefinition[]): void {
  labels.sort((left, right) => {
    const leftColumn = left.navigation?.column ?? 0;
    const rightColumn = right.navigation?.column ?? 0;

    if (leftColumn !== rightColumn) {
      return leftColumn - rightColumn;
    }

    const leftRow = left.navigation?.row ?? 0;
    const rightRow = right.navigation?.row ?? 0;

    if (leftRow !== rightRow) {
      return leftRow - rightRow;
    }

    const leftLayer = left.navigation?.layer ?? 0;
    const rightLayer = right.navigation?.layer ?? 0;

    if (leftLayer !== rightLayer) {
      return leftLayer - rightLayer;
    }

    return left.text.localeCompare(right.text);
  });
}

function averageOrFallback(values: number[], fallback: number): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}
