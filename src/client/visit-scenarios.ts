// Operator-only scene choices. Never add these to an observation envelope.
export const visitScenarios = {
  'challenge-bands': 'Challenge: red, green and orange bands',
  'challenge-shapes': 'Challenge: circle, cross and triangle',
  'challenge-duplicates': 'Challenge: repeated red, unique green band',
  basic: 'Original: moved case, first-seen meter',
  marked: 'Similar cases: visible tape marks',
  twins: 'Identical cases: hidden replacement',
} as const;
export type VisitScenario = keyof typeof visitScenarios;
