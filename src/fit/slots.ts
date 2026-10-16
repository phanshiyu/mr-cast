// Every place a scene draws text, with its font, its lines and the smallest size it reads at. A slot's
// weight is the heaviest it is drawn at, such as when a step lights it, so it fits then too.

import type { Slot } from '../../shared/textfit.mjs';

const SANS = { family: 'sans', balanced: false } as const;
const LABEL = { family: 'sans', balanced: true } as const;
const MONO = { family: 'mono', balanced: true } as const;

/** The slot with its width set. */
export const sized = (slot: Slot, width: Slot['width']): Slot => ({ ...slot, width });

export const SLOTS = {
  eyebrow: { ...SANS, name: 'chapter label', weight: 600, size: 22, min: 16, lines: 1, lineHeight: 1.2, letterSpacing: 3, upper: true, width: 0, fix: 'shorten the chapter' },
  title: { ...SANS, name: 'scene title', weight: 700, size: 50, min: 34, lines: 1, lineHeight: 1.2, letterSpacing: -1, width: 0, fix: 'shorten the title' },
  storyTitle: { ...SANS, name: 'storyboard title line', weight: 500, size: 28, min: 20, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the title or subtitle' },
  summary: { ...SANS, name: 'summary', weight: 700, size: 68, min: 44, lines: 3, lineHeight: 1.12, letterSpacing: -1.5, width: 0, fix: 'shorten the summary' },
  bullet: { ...SANS, name: 'bullet', weight: 600, size: 36, min: 24, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the bullet or split it in two' },
  cardTitle: { ...LABEL, name: 'card title', weight: 650, size: 28, oneLineMin: 21, min: 16, lines: 2, lineHeight: 1.15, width: 0, fix: 'shorten the label, or move detail into its caption' },
  smallCardTitle: { ...LABEL, name: 'card title', weight: 650, size: 25, oneLineMin: 20, min: 15, lines: 2, lineHeight: 1.15, width: 0, fix: 'shorten the label, or move detail into its caption' },
  cardCaption: { ...SANS, name: 'card caption', weight: 400, size: 19, min: 14, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the caption to a few words' },
  smallCardCaption: { ...SANS, name: 'card caption', weight: 400, size: 17, min: 13, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the caption to a few words' },
  edgeLabel: { ...MONO, name: 'edge label', weight: 400, size: 19, min: 15, lines: 3, lineHeight: 1.3, width: 0, fix: 'shorten the label' },
  groupName: { ...SANS, name: 'group name', weight: 700, size: 18, min: 13, lines: 1, lineHeight: 1.3, letterSpacing: 1.4, upper: true, width: 0, fix: 'shorten the group name' },
  messageLabel: { ...MONO, name: 'message label', weight: 650, size: 24, oneLineMin: 15, min: 15, lines: 2, lineHeight: 1.35, width: 0, fix: 'shorten the label, or split the message in two' },
  messageNote: { ...SANS, name: 'message note', weight: 400, size: 18, min: 14, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the note' },
  stateLabel: { ...LABEL, name: 'state label', weight: 650, size: 26, oneLineMin: 22, min: 17, lines: 2, lineHeight: 1.15, width: 0, fix: 'shorten the state name' },
  transitionLabel: { ...MONO, name: 'transition label', weight: 400, size: 18, min: 14, lines: 3, lineHeight: 22 / 18, width: 0, fix: 'shorten the event, e.g. "pay" or "timeout [24h]"' },
  entityName: { ...MONO, name: 'table name', weight: 700, size: 25, min: 16, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the table name' },
  fieldName: { ...MONO, name: 'field', weight: 650, size: 21, min: 15, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the field name or its type' },
  fieldType: { ...MONO, name: 'field type', weight: 400, size: 18, min: 13, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the type, e.g. "text" or "uuid"' },
  relationLabel: { ...MONO, name: 'relation label', weight: 400, size: 17, min: 13, lines: 2, lineHeight: 1.25, width: 0, fix: 'shorten the label' },
  tableCell: { ...SANS, name: 'table cell', weight: 650, size: 30, min: 17, lines: 2, lineHeight: 1.3, balanced: true, width: 0, fix: 'shorten the cell, or split the table' },
  tableCode: { ...MONO, name: 'table cell', weight: 650, size: 28, min: 16, lines: 2, lineHeight: 1.3, markup: false, width: 0, fix: 'shorten the cell, or split the table' },
  tableHeader: { ...SANS, name: 'column header', weight: 700, size: 17, min: 13, lines: 1, lineHeight: 1.3, letterSpacing: 2.5, upper: true, width: 0, fix: 'shorten the header' },
  flowActor: { ...MONO, name: 'actor chip', weight: 600, size: 19, min: 14, lines: 1, lineHeight: 1.3, markup: false, width: 0, fix: 'shorten the actor\'s name' },
  flowAction: { ...SANS, name: 'step', weight: 650, size: 30, min: 20, lines: 2, lineHeight: 1.25, width: 0, fix: 'shorten the action, or use fewer steps so each has two lines' },
  flowStrip: { ...MONO, name: 'current step strip', weight: 700, size: 24, min: 16, lines: 1, lineHeight: 1.3, markup: false, width: 0, fix: 'shorten the actor\'s name' },
  flowHeadline: { ...SANS, name: 'step card', weight: 700, size: 64, oneLineMin: 64, min: 36, lines: 3, lineHeight: 1.15, letterSpacing: -1, width: 0, fix: 'shorten the action' },
  payload: { ...MONO, name: 'payload', weight: 400, size: 40, min: 12, lines: 1, lineHeight: 1.5, markup: false, width: 0, fix: 'shorten the payload to the fields the step changes' },
  stepLabel: { ...LABEL, name: 'step label', weight: 650, size: 26, min: 17, lines: 2, lineHeight: 1.25, width: 0, fix: 'shorten the step label to a few plain words' },
  stepOutcome: { ...LABEL, name: 'step outcome', weight: 400, size: 21, min: 14, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the outcome' },
  codePath: { ...MONO, name: 'file path', weight: 600, size: 36, min: 22, lines: 1, lineHeight: 1.2, markup: false, severity: 'warning', width: 0, fix: 'it is drawn smaller; nothing to change unless it runs into the line counts' },
  hunkHeader: { ...MONO, name: 'hunk header', weight: 400, size: 20, min: 14, lines: 1, lineHeight: 1.2, markup: false, severity: 'warning', width: 0, fix: 'it is drawn smaller; nothing to change' },
  callout: { ...SANS, name: 'callout', weight: 500, size: 28, min: 22, lines: 5, lineHeight: 1.35, width: 0, fix: 'shorten the callout to the one point the code makes' },
  code: { ...MONO, name: 'code line', weight: 400, size: 23, min: 15, lines: 1, lineHeight: 1.65, markup: false, width: 0, fix: 'set "view": "morph", which gives the code twice the width' },
  testName: { ...MONO, name: 'test name', weight: 600, size: 25, min: 14, lines: 2, lineHeight: 1.3, markup: false, width: 0, fix: 'shorten the name, or split the cases into two tests scenes' },
  testProves: { ...LABEL, name: 'what the test proves', weight: 400, size: 25, min: 15, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten what it proves, or split the cases into two tests scenes' },
  testGap: { ...LABEL, name: 'gap', weight: 400, size: 25, min: 15, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the gap' },
  testSubject: { ...MONO, name: 'subject', weight: 400, size: 22, min: 16, lines: 2, lineHeight: 1.25, markup: false, width: 0, fix: 'shorten the subject, e.g. "listEvents in src/lib/pagination.ts"' },
  findingClaim: { ...LABEL, name: 'review claim', weight: 500, size: 30, min: 18, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the claim to what looks wrong; its evidence goes in review.md, not on screen' },
  findingWhere: { ...MONO, name: 'file and line', weight: 600, size: 24, min: 15, lines: 1, lineHeight: 1.3, markup: false, severity: 'warning', width: 0, fix: 'the path is drawn smaller; nothing to change' },
  panelTitle: { ...SANS, name: 'panel title', weight: 800, size: 20, min: 13, lines: 1, lineHeight: 1.2, letterSpacing: 2.5, upper: true, width: 0, fix: 'shorten the title' },
  emptyTitle: { ...SANS, name: 'no-tests title', weight: 800, size: 54, min: 36, lines: 1, lineHeight: 1.2, letterSpacing: -1, width: 0, fix: 'shorten the title' },
  chartLabel: { ...LABEL, name: 'chart label', weight: 600, size: 22, min: 15, lines: 2, lineHeight: 1.3, width: 0, fix: 'shorten the label, or use fewer labels' },
  annotation: { ...LABEL, name: 'annotation', weight: 500, size: 23, min: 17, lines: 2, lineHeight: 31 / 23, width: 0, fix: 'shorten the annotation to the one thing the point shows' },
  legend: { ...SANS, name: 'series name', weight: 400, size: 21, min: 15, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the series name, e.g. "before" and "after"' },
  eventLabel: { ...LABEL, name: 'event label', weight: 650, size: 23, min: 17, lines: 2, lineHeight: 30 / 23, width: 0, fix: 'shorten the label, and move the rest to detail' },
  eventDetail: { ...LABEL, name: 'event detail', weight: 400, size: 19, min: 14, lines: 2, lineHeight: 25 / 19, width: 0, fix: 'shorten the detail' },
  spanLabel: { ...SANS, name: 'span label', weight: 700, size: 19, min: 14, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the span label, e.g. "backoff 4 s"' },
  fileName: { ...MONO, name: 'file name', weight: 600, size: 26, min: 14, lines: 1, lineHeight: 1.2, markup: false, severity: 'warning', width: 0, fix: 'the name is drawn smaller; nothing to change' },
  fileNote: { ...SANS, name: 'file note', weight: 400, size: 24, min: 16, lines: 1, lineHeight: 1.15, width: 0, fix: 'shorten the note to a few words' },
  decision: { ...LABEL, name: 'decision', weight: 650, size: 24, min: 15, lines: 3, lineHeight: 1.15, width: 0, fix: 'ask a shorter question, e.g. "Cache hit?", and put the detail in the narration' },
  terminal: { ...LABEL, name: 'start or end', weight: 650, size: 26, min: 16, lines: 2, lineHeight: 1.15, width: 0, fix: 'shorten it to a few words, e.g. "Order placed"' },
  arrayLabel: { ...MONO, name: 'array name', weight: 600, size: 26, min: 18, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the array name' },
  arrayValue: { ...MONO, name: 'cell value', weight: 650, size: 40, min: 16, lines: 2, lineHeight: 1.15, width: 0, fix: 'shorten the value, or show fewer cells so each is wider' },
  pointerName: { ...MONO, name: 'pointer name', weight: 700, size: 22, min: 14, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the pointer name, e.g. "lo" or "head"' },
  rangeLabel: { ...SANS, name: 'range name', weight: 700, size: 19, min: 19, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the range name, e.g. "window"' },
  frameName: { ...MONO, name: 'frame name', weight: 700, size: 24, min: 16, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the function name' },
  objectType: { ...MONO, name: 'object type', weight: 700, size: 21, min: 15, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the type, e.g. "list" or "Cart"' },
  memoryName: { ...MONO, name: 'variable or field name', weight: 500, size: 22, min: 15, lines: 1, lineHeight: 1.2, markup: false, width: 0, fix: 'shorten the name' },
  memoryValue: { ...MONO, name: 'value', weight: 650, size: 22, min: 15, lines: 1, lineHeight: 1.2, width: 0, fix: 'shorten the value, or say the rest in the narration' },
} satisfies Record<string, Slot>;
