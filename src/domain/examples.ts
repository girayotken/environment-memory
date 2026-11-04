import type { ReplayInput } from './contracts.ts';

// Authored for testing the memory pipeline; never computed from simulator state.
const blueCase = { label: 'Blue case', appearance: 'Rectangular blue case with dark handle and two pale latches', locationDescription: 'On the workbench', uncertainty: 'Authored example. Not inferred from the selected image.', bbox: null };
const drill = { label: 'Yellow drill', appearance: 'Yellow cordless drill with dark base', locationDescription: 'On the workbench beside the robot', uncertainty: 'Authored example. Not inferred from the selected image.', bbox: null };
export const examples: Record<string, { title: string; data: ReplayInput }> = {
  baseline: { title: 'Before: case on bench', data: { schemaVersion: 1, provenance: 'authored_fixture', model: 'authored-memory-example-v1', observations: { summary: 'Authored baseline: a blue case and a yellow drill. No inference.', objects: [blueCase, drill] } } },
  moved: { title: 'After: case under bench', data: { schemaVersion: 1, provenance: 'authored_fixture', model: 'authored-memory-example-v1', observations: { summary: 'Authored change: case under bench, drill not described. No inference.', objects: [{ ...blueCase, locationDescription: 'Under the workbench' }] } } },
  ambiguous: { title: 'Ambiguity: two blue cases', data: { schemaVersion: 1, provenance: 'authored_fixture', model: 'authored-memory-example-v1', observations: { summary: 'Authored ambiguity example with two similar blue cases. No inference.', objects: [blueCase, { ...blueCase, locationDescription: 'Beside the storage shelf' }] } } },
};
