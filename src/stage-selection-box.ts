import type {Camera2D, ViewportSize} from './camera';
import type {LabelNavigationNode} from './label-navigation';
import type {TextLayer} from './text/layer';

const OUTLINE_PADDING = 8;

export function syncStageSelectionBox(input: {
  activeLabelNode: LabelNavigationNode | null;
  camera: Camera2D;
  selectionBox: HTMLDivElement;
  textLayer: TextLayer | null;
  viewport: ViewportSize;
}): void {
  const {activeLabelNode, camera, selectionBox, textLayer, viewport} = input;

  if (!activeLabelNode || !textLayer) {
    selectionBox.hidden = true;
    return;
  }

  const bounds = textLayer.getLabelScreenBounds(activeLabelNode.label, camera, viewport);

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    selectionBox.hidden = true;
    return;
  }

  selectionBox.hidden = false;
  selectionBox.dataset.label = activeLabelNode.key;
  selectionBox.style.left = `${(bounds.left - OUTLINE_PADDING).toFixed(2)}px`;
  selectionBox.style.top = `${(bounds.top - OUTLINE_PADDING).toFixed(2)}px`;
  selectionBox.style.width = `${(bounds.width + OUTLINE_PADDING * 2).toFixed(2)}px`;
  selectionBox.style.height = `${(bounds.height + OUTLINE_PADDING * 2).toFixed(2)}px`;
}
