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
  return {
    labelSetPreset: getDemoLabelSetId(demoLayerCount),
    labels: getDemoLabels(layoutStrategy, demoLayerCount),
    links: getDemoLinks(layoutStrategy),
  };
}

export function createBenchmarkStageScene(labelTargetCount: number): StageScene {
  return {
    labelSetPreset: STATIC_BENCHMARK_LABEL_SET_ID,
    labels: getStaticBenchmarkLabels(labelTargetCount),
    links: [],
  };
}
