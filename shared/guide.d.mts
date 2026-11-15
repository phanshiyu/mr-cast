import type { HunkMap, Scene, Storyboard } from '../src/types';

export type QuestionId = 'why' | 'case' | 'approach' | 'parts' | 'proof' | 'check';

export declare const NOT_STATED: string;

export interface GuideQuestion {
  id: QuestionId;
  label: string;
  /** One or two sentences, or null where the brief does not state it. */
  answer: string | null;
  /** The first scene that answers it, to seek to, or null. */
  scene: number | null;
}

export interface GuideCheck {
  /** "src/cli.ts:1845-1856". */
  where: string;
  what: string;
  why: string;
  /** The scene that shows that place, or null. */
  scene: number | null;
}

export interface GuideDecision {
  kind: 'stated' | 'code' | 'mine';
  /** Who says it: "The author says (commit 7376000)", "The code shows (h2)", "Another way, not the author's". */
  lead: string;
  text: string;
}

export interface GuidePanel {
  questions: GuideQuestion[];
  check: GuideCheck[];
  decisions: GuideDecision[];
  ask: string[];
}

export declare function sceneQuestions(scene: Scene): string[];
export declare function guidePanel(storyboard: Storyboard, hunks: HunkMap): GuidePanel | null;
