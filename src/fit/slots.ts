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
} satisfies Record<string, Slot>;
