import {getDemoLabelSetId} from './data/demo-meta';
import {
  DEFAULT_DEMO_LAYER_COUNT,
  getDemoLabels,
  type LayoutStrategy,
} from './data/labels';
import {getDemoLinks} from './data/links';
import {
  STATIC_BENCHMARK_LABEL_SET_ID,
  getStaticBenchmarkLabels,
} from './data/static-benchmark';
import type {LabelSetKind} from './stage-config';
import type {LinkDefinition} from './line/types';
import type {LabelDefinition} from './text/types';

export type StageScene = {
  labelSetPreset: string;
  labels: LabelDefinition[];
  links: LinkDefinition[];
};

export function cloneStageScene(scene: StageScene): StageScene {
  return {
    labelSetPreset: scene.labelSetPreset,
    labels: scene.labels.map((label) => ({
      ...label,
      color: label.color ? [...label.color] : undefined,
      inputLinkKeys: [...label.inputLinkKeys],
      location: {...label.location},
      navigation: label.navigation ? {...label.navigation} : undefined,
      outputLinkKeys: [...label.outputLinkKeys],
      planeBasisX: label.planeBasisX ? {...label.planeBasisX} : undefined,
      planeBasisY: label.planeBasisY ? {...label.planeBasisY} : undefined,
    })),
    links: scene.links.map((link) => ({
      ...link,
      color: [...link.color],
      inputLocation: {...link.inputLocation},
      outputLocation: {...link.outputLocation},
    })),
  };
}

export function createEmptyStageScene(labelSetPreset: string): StageScene {
  return {
    labelSetPreset,
    labels: [],
    links: [],
  };
}

export function createStageScene(options: {
  demoLayerCount: number;
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  layoutStrategy: LayoutStrategy;
}): StageScene {
  return options.labelSetKind === 'benchmark'
    ? createBenchmarkStageScene(options.labelTargetCount)
    : createDemoStageScene(options.layoutStrategy, options.demoLayerCount);
}

export function createDemoStageScene(
  layoutStrategy: LayoutStrategy,
  demoLayerCount: number = DEFAULT_DEMO_LAYER_COUNT,
): StageScene {
  const labels = getDemoLabels(layoutStrategy, demoLayerCount);
  const links = getDemoLinks(layoutStrategy);

  connectLabelSetLinks(labels, links);

  return {
    labelSetPreset: getDemoLabelSetId(demoLayerCount),
    labels,
    links,
  };
}

export function createBenchmarkStageScene(labelTargetCount: number): StageScene {
  const labels = getStaticBenchmarkLabels(labelTargetCount);

  connectLabelSetLinks(labels, []);

  return {
    labelSetPreset: STATIC_BENCHMARK_LABEL_SET_ID,
    labels,
    links: [],
  };
}

function connectLabelSetLinks(labels: LabelDefinition[], links: LinkDefinition[]): void {
  const labelsByCellKey = new Map<string, LabelDefinition[]>();

  for (const label of labels) {
    label.inputLinkKeys.length = 0;
    label.outputLinkKeys.length = 0;

    if (!label.navigation) {
      continue;
    }

    const cellKey = getLabelCellKey(label.navigation.column, label.navigation.row);
    const cellLabels = labelsByCellKey.get(cellKey);

    if (cellLabels) {
      cellLabels.push(label);
      continue;
    }

    labelsByCellKey.set(cellKey, [label]);
  }

  for (const link of links) {
    const outputCellLabels = labelsByCellKey.get(getCellKeyFromRootLabel(link.outputLabelKey)) ?? [];
    const inputCellLabels = labelsByCellKey.get(getCellKeyFromRootLabel(link.inputLabelKey)) ?? [];

    for (const label of outputCellLabels) {
      label.outputLinkKeys.push(link.linkKey);
    }

    for (const label of inputCellLabels) {
      label.inputLinkKeys.push(link.linkKey);
    }
  }
}

function getCellKeyFromRootLabel(labelKey: string): string {
  const [column = '', row = ''] = labelKey.split(':');
  return `${column}:${row}`;
}

function getLabelCellKey(column: number, row: number): string {
  return `${column}:${row}`;
}
