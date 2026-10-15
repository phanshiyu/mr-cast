// ─── hunks.json (written by `mr-cast extract` or `mr-cast explain snippet`) ──

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
  /** "source" is an unchanged snippet of a file (`explain snippet`): every line is context, numbered as in the file. */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'source';
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
// bin/lib/install-skill.mjs copies this block into the skill, from the Risk declaration up to the next section.

export type Risk = 'low' | 'medium' | 'high';
export type NodeKind = 'service' | 'db' | 'queue' | 'client';

interface SceneBase {
  /** Short title shown in the chapter sidebar. Defaults to a per-type label. */
  chapter?: string;
  /** Spoken voice-over and subtitle text. Scene length follows the spoken audio, or the word count without voice. A code scene with `steps` says it before the first step. */
  narration: string;
}

export interface IntentScene extends SceneBase {
  type: 'intent';
  summary: string;
  /** Required in a diff walkthrough. An explanation (explain mode) leaves it out. */
  risk?: Risk;
  bullets: string[];
}

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Highlight as touched by this change, or in an explanation as a key part of the idea. */
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

/** One step of a code scene: the lines it highlights and the words spoken while they are highlighted. */
export interface CodeStep {
  /** New-file line number or "a-b" range to highlight (the + numbers in the index). Set this or `oldLines`. */
  lines?: LineRef;
  /** Old-file line number or range, for removed code. */
  oldLines?: LineRef;
  /** Spoken while the lines are highlighted. The step lasts as long as it takes to say, so the voice tracks the line. */
  say: string;
  /** With a label on every step, a flow diagram beside the code lights up one node per step. Plain words about what the lines do, e.g. "count the request in Redis". */
  label?: string;
  /** Where a labelled step branches or ends, e.g. "past twenty it answers too many requests". */
  outcome?: string;
}

export interface CodeScene extends SceneBase {
  type: 'code';
  hunkId: string;
  /** Walk the hunk step by step, top to bottom, each step saying its own words while its lines are highlighted.
   *  `narration` is then the intro spoken before the first step. Replaces focusLinesAfter, focusLinesBefore and flow. */
  steps?: CodeStep[];
  /** New-file line numbers to emphasise; everything else is dimmed. Each "a-b" string is one step and consecutive plain numbers join into one; steps play top to bottom. Defaults to the changed lines, or the whole snippet for a source hunk. */
  focusLinesAfter?: LineRef[];
  /** Old-file line numbers to emphasise (useful for deletions). */
  focusLinesBefore?: LineRef[];
  calloutText?: string;
  /** "split" = side-by-side; "morph" = removed lines collapse, added lines grow in. Auto when omitted (morph when `flow` is set). */
  view?: 'split' | 'morph';
  /** A short flow diagram beside the code: one step per focus range, in the same top-to-bottom order.
   *  Each step says in plain words what that range does, e.g. "count the request in Redis". */
  flow?: { label: string; outcome?: string }[];
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

export type MessageKind = 'call' | 'return' | 'async';

export interface SequenceParticipant {
  id: string;
  label: string;
  kind?: NodeKind;
  /** Highlight as touched by this change, or in an explanation as a key participant. */
  modified?: boolean;
}

export interface SequenceMessage {
  from: string;
  /** Same as `from` for a self-call. */
  to: string;
  label: string;
  /** "call" (default) is a solid arrow, "return" a dashed one, "async" an open arrowhead. */
  kind?: MessageKind;
  /** Highlight a message this change adds or alters, or in an explanation the key step. */
  modified?: boolean;
  /** Short annotation shown beside the message. */
  note?: string;
}

export interface SequenceScene extends SceneBase {
  type: 'sequence';
  title?: string;
  participants: SequenceParticipant[];
  /** In time order, top to bottom. */
  messages: SequenceMessage[];
}

export type Change = 'added' | 'removed' | 'modified';
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface ErField {
  name: string;
  type?: string;
  pk?: boolean;
  fk?: boolean;
  change?: Change;
}

export interface ErEntity {
  id: string;
  /** Table or model name as it appears in code. */
  name: string;
  fields: ErField[];
  change?: Change;
}

export interface ErRelation {
  /** For one-to-many, `from` is the "one" side and `to` the "many" side. */
  from: string;
  to: string;
  cardinality: Cardinality;
  label?: string;
  change?: Change;
}

export interface ErScene extends SceneBase {
  type: 'er';
  title?: string;
  entities: ErEntity[];
  relations: ErRelation[];
}

export interface StateNode {
  id: string;
  label: string;
  /** A terminal state, drawn with a double border. */
  final?: boolean;
  change?: Change;
}

export interface StateTransition {
  from: string;
  /** Same as `from` for a self-transition. */
  to: string;
  /** The event or guard, e.g. "pay" or "timeout [24h]". */
  label?: string;
  change?: Change;
}

export interface StateScene extends SceneBase {
  type: 'state';
  title?: string;
  /** Id of the starting state; drawn with an entry dot. */
  initial?: string;
  states: StateNode[];
  transitions: StateTransition[];
}

export interface MermaidScene extends SceneBase {
  type: 'mermaid';
  title?: string;
  /** Mermaid source for diagrams no other scene covers. Rendered as a static diagram. */
  code: string;
}

export type TestStatus = 'added' | 'modified' | 'removed' | 'existing';

export interface TestCase {
  /** The test's name as written in code. */
  name: string;
  /** The behavior it proves, in plain words. */
  proves: string;
  /** Defaults to "added". Use "existing" for an unchanged test that already covers the changed code. */
  status?: TestStatus;
  /** Hunk with this test's code, if the diff has it. Linking a test hunk here counts it as shown. */
  hunkId?: string;
}

export interface TestsScene extends SceneBase {
  type: 'tests';
  title?: string;
  /** The code under test, e.g. "listEvents in src/lib/pagination.ts". */
  subject?: string;
  /** Every relevant test, in the order the narration names them. Empty when the change has no tests. */
  cases: TestCase[];
  /** Important behaviors this change introduces that no test covers. Empty means you checked and found none. */
  gaps: string[];
}

/** A cell's text, or `{ before, after }` for a value this change replaced: the old value is struck through beside the new one. */
export type TableCell = string | { before: string; after: string };

/**
 * One cell per column. An added or removed row holds plain text; a row with a `{ before, after }`
 * cell is modified, with or without `change: "modified"`.
 */
export type TableRow = { cells: TableCell[]; change?: 'modified' } | { cells: string[]; change: 'added' | 'removed' };

export interface TableScene extends SceneBase {
  type: 'table';
  title?: string;
  /** Column headers, left to right. Up to 6. */
  columns: string[];
  /** Up to 10 rows. Long text wraps to two lines. */
  rows: TableRow[];
  /** Row indexes (0-based) to spotlight one at a time, in the order the narration names them. */
  highlight?: number[];
  /**
   * Walk rows one at a time, each with its own words: the row lights up just before its `say` is spoken.
   * `narration` is then the intro spoken before the first step. Replaces `highlight`.
   */
  steps?: TableStep[];
}

export interface TableStep {
  /** Row index (0-based). */
  row: number;
  /** Spoken while the row is lit. */
  say: string;
}

/** Colour of a series, event or span. Neutral is grey, accent is the highlight blue, good green, bad red, warn amber. */
export type Tone = 'neutral' | 'accent' | 'good' | 'bad' | 'warn';

export interface ChartSeries {
  /** Shown in the legend, e.g. "before" and "after". */
  name: string;
  /** One number per label, in the same order. Bars need values of 0 or more. */
  values: number[];
  /** Defaults: one series is accent; two are neutral then accent (before, after); more cycle through the tones. */
  tone?: Tone;
}

export interface ChartScene extends SceneBase {
  type: 'chart';
  /** "bar" for categories (p50, p95, p99), "line" for a trend over ordered labels (dates, versions, load). */
  kind: 'bar' | 'line';
  title?: string;
  /** Unit printed after each value, e.g. "ms", "MB", "%", "req/s". */
  unit?: string;
  /** X-axis categories, left to right. Up to 12. */
  labels: string[];
  /** Up to 4. With exactly two, each label gets a badge with the change from the first to the second, e.g. "−42%". */
  series: ChartSeries[];
  /** Which direction is an improvement, so the change badges read green or red. Without it they stay neutral. */
  better?: 'lower' | 'higher';
  /** Calls out one point: the value at label `at` of series `series` (a series name, default the last series). */
  annotation?: { at: string; series?: string; text: string };
}

export interface TimelineEvent {
  /** Position on the axis, in the scene's unit. */
  at: number;
  label: string;
  /** A second, smaller line under the label. */
  detail?: string;
  tone?: Tone;
}

export interface TimelineSpan {
  from: number;
  to: number;
  /** What fills the interval, e.g. "rate-limit window" or "backoff 4 s". */
  label: string;
  tone?: Tone;
}

export interface TimelineScene extends SceneBase {
  type: 'timeline';
  title?: string;
  /** Unit of every `at`, `from` and `to`. */
  unit: 'ms' | 's' | 'min' | 'h' | 'd';
  /** Revealed left to right. Up to 8. */
  events: TimelineEvent[];
  /** Intervals drawn as bands under the axis, such as a wait, a window or a phase. Up to 4. */
  spans?: TimelineSpan[];
}

export interface FileEntry {
  /** Repository-relative path. */
  path: string;
  /** Marks the file as added, removed or modified. In a diff walkthrough defaults to what hunks.json says. */
  change?: Change;
  /** Lines added and removed. In a diff walkthrough default to the counts in hunks.json. */
  additions?: number;
  deletions?: number;
}

export interface FilesScene extends SceneBase {
  type: 'files';
  title?: string;
  /**
   * The files to list as a tree. Omit in a diff walkthrough to list every changed file in hunks.json
   * with its line counts, tests marked. Required in an explanation.
   */
  files?: FileEntry[];
  /** A short note beside a file, keyed by its path, e.g. { "src/limiter.ts": "new token bucket" }. */
  notes?: Record<string, string>;
  /** Paths to spotlight one at a time, in the order the narration names them. Defaults to the files with notes, top to bottom. */
  highlight?: string[];
  /**
   * Walk files one at a time, each with its own words: the file lights up just before its `say` is spoken.
   * `narration` is then the intro spoken before the first step. Replaces `highlight`.
   */
  steps?: FileStep[];
}

export interface FileStep {
  /** A path in the tree. */
  path: string;
  /** Spoken while the file is lit. */
  say: string;
}

export type Scene = IntentScene | ArchScene | CodeScene | FlowScene | SequenceScene | ErScene | StateScene | MermaidScene | TestsScene | TableScene | ChartScene | TimelineScene | FilesScene;

export interface Storyboard {
  title: string;
  subtitle?: string;
  scenes: Scene[];
  /**
   * Hunks deliberately left out of every code scene, each with the reason a reviewer would accept,
   * e.g. "formatting only", "generated lockfile", "renamed import". `validate` warns about every
   * test hunk and every hunk of 15+ changed lines that is neither shown nor listed here.
   */
  skipped?: SkippedHunk[];
}

export interface SkippedHunk {
  hunkId: string;
  reason: string;
}

// ─── voiceover.json (written by `mr-cast voice`) ─────────────────────────────

export interface VoiceClip {
  /** WAV path relative to the .mr-cast directory, e.g. "audio/1a2b3c4d.wav". */
  src: string;
  seconds: number;
  /** When each sentence is spoken, so captions follow the voice through the pauses between sentences. */
  sentences?: VoiceSentence[];
}

export interface VoiceSentence {
  words: number;
  /** Seconds from the clip's start to the sentence's first and last sound. */
  start: number;
  end: number;
}

export interface Voiceover {
  voice: string;
  /** Kokoro's speaking speed, 0.5 to 2 (1 when absent). Scales the reading pace of text without a clip too. */
  speed?: number;
  /** Factor on every pause around the voice (1 when absent): 1.5 at the slower pace. */
  pauses?: number;
  /** Keyed by narrationKey(narration, voice, speed) from shared/voice.mjs. */
  clips: Record<string, VoiceClip>;
}

// ─── Composition props ───────────────────────────────────────────────────────

export interface WalkthroughProps {
  storyboard: Storyboard;
  hunks: HunkMap;
  /** Burn subtitles into the video (on for MP4 renders, off in the player which has its own HUD). */
  showCaptions: boolean;
  /** Voiced scenes last as long as their clip and play it. Without it, scenes are silent and timed from word count. */
  voiceover?: Voiceover | null;
  /** URL prefix for clip `src` paths: "./data/" in the player, a local server in renders. Without it no audio plays (stills). */
  audioBaseUrl?: string;
  [key: string]: unknown;
}
