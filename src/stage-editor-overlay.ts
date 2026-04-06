export type StageEditorScreenBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type StageEditorGhostOverlayItem = {
  bounds: StageEditorScreenBounds;
  direction: string;
  key: string;
};

export type StageEditorSelectionRankOverlayItem = {
  bounds: StageEditorScreenBounds;
  key: string;
  rank: number;
};

const OUTLINE_PADDING = 8;

export function syncStageEditorSelectionBox(input: {
  bounds: StageEditorScreenBounds | null;
  cursorKind: 'ghost' | 'label' | null;
  key: string | null;
  selectionBox: HTMLDivElement;
}): void {
  const {bounds, cursorKind, key, selectionBox} = input;

  if (!bounds || !key || !cursorKind) {
    selectionBox.hidden = true;
    return;
  }

  selectionBox.hidden = false;
  selectionBox.dataset.cursorKind = cursorKind;
  selectionBox.dataset.label = key;
  selectionBox.style.left = `${(bounds.left - OUTLINE_PADDING).toFixed(2)}px`;
  selectionBox.style.top = `${(bounds.top - OUTLINE_PADDING).toFixed(2)}px`;
  selectionBox.style.width = `${(bounds.width + OUTLINE_PADDING * 2).toFixed(2)}px`;
  selectionBox.style.height = `${(bounds.height + OUTLINE_PADDING * 2).toFixed(2)}px`;
}

export function syncStageEditorGhostLayer(input: {
  ghostLayer: HTMLDivElement;
  ghosts: StageEditorGhostOverlayItem[];
}): void {
  const {ghostLayer, ghosts} = input;

  if (ghosts.length === 0) {
    ghostLayer.replaceChildren();
    return;
  }

  ghostLayer.replaceChildren(
    ...ghosts.map((ghost) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-slot';
      button.dataset.ghostDirection = ghost.direction;
      button.dataset.ghostKey = ghost.key;
      button.dataset.testid = `ghost-slot-${ghost.direction}`;
      button.style.left = `${ghost.bounds.left.toFixed(2)}px`;
      button.style.top = `${ghost.bounds.top.toFixed(2)}px`;
      button.style.width = `${ghost.bounds.width.toFixed(2)}px`;
      button.style.height = `${ghost.bounds.height.toFixed(2)}px`;
      button.textContent = '+';
      button.setAttribute('aria-label', `Ghost slot ${ghost.key}`);
      return button;
    }),
  );
}

export function syncStageEditorSelectionLayer(input: {
  selectionLayer: HTMLDivElement;
  selections: StageEditorSelectionRankOverlayItem[];
}): void {
  const {selectionLayer, selections} = input;

  if (selections.length === 0) {
    selectionLayer.replaceChildren();
    return;
  }

  selectionLayer.replaceChildren(
    ...selections.map((selection) => {
      const badge = document.createElement('div');
      badge.className = 'selection-rank-badge';
      badge.dataset.labelKey = selection.key;
      badge.dataset.rank = String(selection.rank);
      badge.style.left = `${(selection.bounds.left + selection.bounds.width - 10).toFixed(2)}px`;
      badge.style.top = `${(selection.bounds.top - 10).toFixed(2)}px`;
      badge.textContent = String(selection.rank);
      badge.setAttribute('aria-hidden', 'true');
      return badge;
    }),
  );
}
