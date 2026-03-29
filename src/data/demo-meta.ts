import {DEFAULT_DEMO_LAYER_COUNT, MIN_DEMO_LAYER_COUNT} from './labels';

const MIN_LAYER_DEMO_LABEL_SET_ID = 'scene-12x12-v1';

export function getDemoLabelSetId(layerCount: number): string {
  return layerCount <= MIN_DEMO_LAYER_COUNT
    ? MIN_LAYER_DEMO_LABEL_SET_ID
    : `scene-12x12x${Math.round(layerCount)}-v1`;
}

export const DEMO_LABEL_SET_ID = getDemoLabelSetId(DEFAULT_DEMO_LAYER_COUNT);
