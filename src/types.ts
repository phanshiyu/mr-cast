// ─── hunks.json (written by `mr-cast extract`) ───────────────────────────────

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface Hunk {
  id: string;
  file: string;
  oldFile: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  language: string;
  /** Function / class context git found for the hunk (may be empty). */
  header: string;
  /** First line of the hunk in the new file. */
  startLine: number;
  oldStartLine: number;
  endLine: number;
  additions: number;
  deletions: number;
  beforeCode: string;
  afterCode: string;
  lines: DiffLine[];
}

export type HunkMap = Record<string, Hunk>;

// ─── storyboard.json (written by the LLM) ────────────────────────────────────
// scripts/install-skill.mjs copies this block into the skill, from the Risk declaration up to Composition props.

export type Risk = 'low' | 'medium' | 'high';
export type NodeKind = 'service' | 'db' | 'queue' | 'client';

interface SceneBase {
  /** Short title shown in the chapter sidebar. Defaults to a per-type label. */
  chapter?: string;
  /** Voice-over / subtitle text. Scene length is derived from its word count. */
  narration: string;
}

export interface IntentScene extends SceneBase {
  type: 'intent';
  summary: string;
  risk: Risk;
  bullets: string[];
}

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Highlight as touched by this change. */
  modified?: boolean;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ArchScene extends SceneBase {
  type: 'arch';
  nodes: ArchNode[];
  edges: ArchEdge[];
}

/** A line number or an inclusive range written as "12-18". */
export type LineRef = number | string;

export interface CodeScene extends SceneBase {
  type: 'code';
  hunkId: string;
  /** New-file line numbers to emphasise; everything else is dimmed. Defaults to the changed lines. */
  focusLinesAfter?: LineRef[];
  /** Old-file line numbers to emphasise (useful for deletions). */
  focusLinesBefore?: LineRef[];
  calloutText?: string;
  /** "split" = side-by-side; "morph" = removed lines collapse, added lines grow in. Auto when omitted. */
  view?: 'split' | 'morph';
}

export interface FlowStep {
  /** Who is acting: a service, function, or component name. */
  actor: string;
  /** What happens at this step. */
  action: string;
  /** The data as it looks after this step (JSON, a struct, a short code snippet...). */
  payload?: string;
}

export interface FlowScene extends SceneBase {
  type: 'flow';
  title?: string;
  steps: FlowStep[];
}

export type Scene = IntentScene | ArchScene | CodeScene | FlowScene;

export interface Storyboard {
  title: string;
  subtitle?: string;
  scenes: Scene[];
}

// ─── Composition props ───────────────────────────────────────────────────────

export interface WalkthroughProps {
  storyboard: Storyboard;
  hunks: HunkMap;
  /** Burn subtitles into the video (on for MP4 renders, off in the player which has its own HUD). */
  showCaptions: boolean;
  [key: string]: unknown;
}
