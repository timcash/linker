import type {LabelDefinition} from '../text/types';

export const DEMO_LABELS: LabelDefinition[] = [
  {
    location: {x: -4.2, y: -2.7},
    maxZoom: 0.15,
    minZoom: -4,
    size: 1.1,
    text: 'BUTTON PAN',
  },
  {
    location: {x: 2.2, y: 0.25},
    maxZoom: 0.7,
    minZoom: -0.2,
    size: 1,
    text: 'WEBGPU LABEL',
    color: [0.96, 0.98, 1, 1],
  },
  {
    location: {x: 3.4, y: 2.45},
    maxZoom: 1.8,
    minZoom: 0.2,
    size: 1.1,
    text: 'LUMA TEXT',
    color: [0.78, 0.91, 1, 1],
  },
  {
    location: {x: 4.1, y: 1},
    maxZoom: 2.2,
    minZoom: 0.7,
    size: 0.9,
    text: 'MID DETAIL',
    color: [0.84, 0.95, 1, 1],
  },
  {
    location: {x: 4.4, y: -1.7},
    maxZoom: 4,
    minZoom: 0.95,
    size: 0.8,
    text: 'CLOSE READ',
    color: [0.92, 0.96, 1, 1],
  },
  {
    location: {x: 4.5, y: 3},
    maxZoom: -0.3,
    minZoom: -4,
    size: 1.2,
    text: 'WORLD VIEW',
    color: [0.87, 0.94, 1, 1],
  },
];
