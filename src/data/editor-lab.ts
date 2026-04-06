import type {StageSystemState} from '../plane-stack';
import {createFiveWorkplaneGridState} from './workplane-grid-stack';

export function createDefaultEditorLabState(): StageSystemState {
  return createFiveWorkplaneGridState({
    stageMode: '2d-mode',
  });
}
