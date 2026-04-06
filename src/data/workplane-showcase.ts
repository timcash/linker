import type {StageSystemState} from '../plane-stack';
import {createFiveWorkplaneGridState} from './workplane-grid-stack';

export function createDefaultWorkplaneShowcaseState(): StageSystemState {
  return createFiveWorkplaneGridState({
    stageMode: '3d-mode',
  });
}
