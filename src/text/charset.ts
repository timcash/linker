import type {LabelDefinition} from './types';

export function getCharacterSetFromLabels(labels: LabelDefinition[]): string[] {
  return [...new Set(labels.flatMap((label) => [...label.text]))].sort();
}
