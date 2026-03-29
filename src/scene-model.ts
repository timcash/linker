import {DEMO_LABEL_SET_ID} from './data/demo-meta';
import {getDemoLabels, type LayoutStrategy} from './data/labels';
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
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  layoutStrategy: LayoutStrategy;
}): StageScene {
  return options.labelSetKind === 'benchmark'
    ? createBenchmarkStageScene(options.labelTargetCount)
    : createDemoStageScene(options.layoutStrategy);
}

export function createDemoStageScene(layoutStrategy: LayoutStrategy): StageScene {
  return {
    labelSetPreset: DEMO_LABEL_SET_ID,
    labels: getDemoLabels(layoutStrategy),
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
