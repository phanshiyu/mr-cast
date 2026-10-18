// The ways a topic of the plan can be shown, in the viewer's words. plan.json names them by key, the plan page
// shows their labels, and validate checks each topic's scenes against the scene types that draw them.

export const VIEWS = {
  parts: { label: 'The parts and how they connect', scenes: ['graph'] },
  calls: { label: 'Who calls whom, in order', scenes: ['sequence'] },
  data: { label: 'The data at each step', scenes: ['flow'] },
  decisions: { label: 'The decisions it makes', scenes: ['graph'] },
  states: { label: 'The states it moves through', scenes: ['state'] },
  layers: { label: 'The layers a request passes', scenes: ['layers'] },
  schema: { label: 'The data model', scenes: ['er'] },
  compare: { label: 'Before vs after', scenes: ['compare'] },
  timing: { label: 'When things happen', scenes: ['timeline'] },
  facts: { label: 'The facts in a table', scenes: ['table'] },
  numbers: { label: 'The numbers', scenes: ['chart'] },
  shell: { label: 'Run it in a terminal', scenes: ['terminal'] },
  memory: { label: 'What the program holds', scenes: ['memory'] },
  steps: { label: 'Values changing step by step', scenes: ['array'] },
  code: { label: 'Just the code', scenes: ['code'] },
};

export const isView = (key) => typeof key === 'string' && Object.hasOwn(VIEWS, key);
