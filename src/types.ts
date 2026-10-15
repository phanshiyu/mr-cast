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

/** What a diff does to an item. Drawn green with a NEW badge, red struck through with REMOVED, or blue with CHANGED. */
export type Change = 'added' | 'removed' | 'modified';

/**
 * Three separate ways to mark an item, never to be swapped for one another:
 * `change` says what the diff does to it, `badge` is a label of your own, and `highlight` (or a focus
 * step) points the viewer at it.
 */
export interface Marks {
  /**
   * What this diff does to the item. Mark exactly what the diff changes and nothing else: the viewer
   * reads every mark as a fact about the diff. An explanation has no diff, so it leaves `change` off
   * unless it explains a change and sets `explainsChange`.
   */
  change?: Change;
  /**
   * "Look here", for a part the whole scene is about: a soft white glow with no word, which never reads as a
   * change. To point at parts one at a time as the voice names them, use focus `steps` instead.
   */
  highlight?: boolean;
  /**
   * A short label of your own, up to 14 characters, e.g. "hot path", "v2", "owner" or "key", drawn as a pill in
   * `tone` (neutral by default). Never a change word: use `change` for what the diff does.
   */
  badge?: string;
  /** Colour of the badge (and of a node's icon or a timeline mark). */
  tone?: Tone;
}

interface SceneBase {
  /** Short title shown in the chapter sidebar. Defaults to a per-type label. */
  chapter?: string;
  /** In an explanation, this scene explains a change, so its `change` marks are meant (see Storyboard.explainsChange). */
  explainsChange?: boolean;
  /**
   * Spoken voice-over and subtitle text. Scene length follows the spoken audio, or the word count without voice.
   * The voice starts once the scene has drawn in. A scene with `steps` says it before the first step.
   */
  narration: string;
}

/** What a step points the viewer at. Each scene type's `steps` says which refs it takes. */
export type FocusRef = string | number;

/**
 * A pen stroke drawn by hand on what a step points at: "circle" rings it, "underline" and "box" draw
 * under and around it, "arrow" points at it from a free spot with the `note` at its tail, "strike"
 * crosses it out with one line and "cross" with an X.
 */
export type PenMark = 'circle' | 'underline' | 'box' | 'arrow' | 'strike' | 'cross';

/**
 * Optional pen marks on a step. The mark draws itself in the half second before the step's words and
 * is gone when the next step starts. Mark rarely: the one thing the sentence is about on a busy screen,
 * a risky value, a missing piece. Focus alone is enough on a simple diagram.
 */
export interface PenMarks {
  /** Drawn on the step's first focus ref (all of it, for a range), or a code step's lines or `token`. */
  mark?: PenMark;
  /** A short handwritten label beside the mark, up to 40 characters, e.g. "single point of failure". Needs `mark`. */
  note?: string;
}

/** One beat of a diagram: what to light, and the words spoken while it is lit. */
export interface FocusStep extends PenMarks {
  /** One ref, or several lit together, such as a node and the edge leaving it. */
  focus: FocusRef | FocusRef[];
  /** Spoken while it is lit. The light lands half a second before the words. */
  say: string;
}

export interface IntentScene extends SceneBase {
  type: 'intent';
  summary: string;
  /** Required in a diff walkthrough. An explanation (explain mode) leaves it out. */
  risk?: Risk;
  bullets: string[];
  /**
   * Move the viewer's attention as the voice explains: every bullet shows, then each step lights the
   * bullets it focuses just before its `say` is spoken. `narration` is then the intro. A ref is a bullet index (0-based).
   */
  steps?: FocusStep[];
}

/**
 * A card in an arch or sequence scene: a service, a database, a person, a team, a document, a device.
 * Older storyboards wrote `kind` ("service", "db", "queue" or "client") for the icon and caption, and
 * `modified: true`, which reads as `change: "modified"` in a diff walkthrough and `highlight` in an explanation.
 */
export interface DiagramNode extends Marks {
  id: string;
  label: string;
  /**
   * Any Lucide icon name in kebab-case (https://lucide.dev/icons), e.g. "server", "database", "user",
   * "users", "headset", "building-2", "smartphone", "file-text". Drawn left of the label; none when absent.
   */
  icon?: string;
  /** A short line under the label saying what it is, e.g. "datastore", "customer", "on call". None when absent. */
  caption?: string;
  /** Colour of its icon and badge, for telling kinds of things apart, e.g. people "good" and systems "neutral". */
  tone?: Tone;
}

export interface ArchNode extends DiagramNode {
  /** Name of a group, e.g. "Support team". Nodes with the same group are drawn inside one labelled box. */
  group?: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  /** "forward" (default) points from → to, "both" points at each end for a two-way relationship, "none" draws a plain line. */
  direction?: 'forward' | 'both' | 'none';
  /**
   * "flow" moves dashes along a forward edge, for requests or data in motion; "solid" is a still line,
   * for a relationship such as "reports to"; "dashed" is a still dashed line, for a weak, optional or
   * indirect link. Defaults to "flow" for a forward edge and "solid" otherwise.
   */
  style?: 'flow' | 'solid' | 'dashed';
  /** An edge this diff adds (green), removes (dashed red) or alters (blue). */
  change?: Change;
  /** "Look here": the edge glows white. */
  highlight?: boolean;
}

export interface ArchScene extends SceneBase {
  type: 'arch';
  nodes: ArchNode[];
  edges: ArchEdge[];
  /** "LR" (default) lays the graph out left to right; "TB" top to bottom, which suits hierarchies such as people and teams. */
  layout?: 'LR' | 'TB';
  /**
   * Move the viewer's attention as the voice explains: the whole graph draws first, then each step lights
   * what it focuses just before its `say` is spoken while the rest dims. `narration` is then the intro.
   * A ref is a node id, an edge "from->to" (or "a-b" for either direction), a group "group:Support team",
   * or an edge index. Walk a path with a node, then its edge, then the next node.
   */
  steps?: FocusStep[];
}

/** A line number or an inclusive range written as "12-18". */
export type LineRef = number | string;

/** One step of a code scene: the lines it highlights and the words spoken while they are highlighted. */
export interface CodeStep extends PenMarks {
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
  /** Text that occurs exactly once in the step's lines, e.g. "max: 20", for `mark` to draw on instead of the whole lines. */
  token?: string;
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
  /** A Lucide icon name for the actor, as on a diagram node, e.g. "user" or "server". */
  icon?: string;
  /** Colour of the actor's chip and icon. */
  tone?: Tone;
  /**
   * Spoken while this step is the current one; it becomes current just before its words. Give every step
   * a `say` or none. Without them the current step moves through the steps while the narration plays.
   */
  say?: string;
}

export interface FlowScene extends SceneBase {
  type: 'flow';
  title?: string;
  /** With a `say` on each, `narration` is the intro spoken before the first step. */
  steps: FlowStep[];
}

export type MessageKind = 'call' | 'return' | 'async';

export type SequenceParticipant = DiagramNode;

/** Older storyboards wrote `modified: true`, which reads as `change: "modified"` in a diff walkthrough and `highlight` in an explanation. */
export interface SequenceMessage extends Marks {
  from: string;
  /** Same as `from` for a self-call. */
  to: string;
  label: string;
  /** "call" (default) is a solid arrow, "return" a dashed one, "async" an open arrowhead. */
  kind?: MessageKind;
  /** Short annotation shown beside the message. */
  note?: string;
}

export interface SequenceScene extends SceneBase {
  type: 'sequence';
  title?: string;
  participants: SequenceParticipant[];
  /** In time order, top to bottom. */
  messages: SequenceMessage[];
  /**
   * Walk the messages in order, each step with its own words: the participants draw first, then each step's
   * messages draw in and light up just before its `say` is spoken. `narration` is then the intro.
   * A ref is a message index (0-based), an inclusive "a-b" range of them, or a participant id. A step draws
   * every message up to the last one it focuses, so focus them in order.
   */
  steps?: FocusStep[];
}

export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

export interface ErField extends Marks {
  name: string;
  type?: string;
  pk?: boolean;
  fk?: boolean;
}

export interface ErEntity extends Marks {
  id: string;
  /** Table or model name as it appears in code. */
  name: string;
  fields: ErField[];
}

export interface ErRelation extends Marks {
  /** For one-to-many, `from` is the "one" side and `to` the "many" side. */
  from: string;
  to: string;
  cardinality: Cardinality;
  label?: string;
}

export interface ErScene extends SceneBase {
  type: 'er';
  title?: string;
  entities: ErEntity[];
  relations: ErRelation[];
  /**
   * Move the viewer's attention as the voice explains: the whole model draws first, then each step lights
   * what it focuses just before its `say` is spoken while the rest dims. `narration` is then the intro.
   * A ref is an entity id, a field "entity.field" (e.g. "orders.status"), a relation "from->to", or a relation index.
   */
  steps?: FocusStep[];
}

export interface StateNode extends Marks {
  id: string;
  label: string;
  /** A terminal state, drawn with a double border. */
  final?: boolean;
}

export interface StateTransition extends Marks {
  from: string;
  /** Same as `from` for a self-transition. */
  to: string;
  /** The event or guard, e.g. "pay" or "timeout [24h]". */
  label?: string;
}

export interface StateScene extends SceneBase {
  type: 'state';
  title?: string;
  /** Id of the starting state; drawn with an entry dot. */
  initial?: string;
  states: StateNode[];
  transitions: StateTransition[];
  /**
   * Move the viewer's attention as the voice explains: the whole machine draws first, then each step lights
   * what it focuses just before its `say` is spoken while the rest dims. `narration` is then the intro.
   * A ref is a state id, a transition "from->to" (every transition between them), a transition's exact
   * label such as "pay", or a transition index (0-based) to pick one of several.
   */
  steps?: FocusStep[];
}

export interface MermaidScene extends SceneBase {
  type: 'mermaid';
  title?: string;
  /** Mermaid source for diagrams no other scene covers. Rendered as a static diagram. */
  code: string;
}

export type TestStatus = 'added' | 'modified' | 'removed' | 'existing';

export interface TestCase extends Pick<Marks, 'badge' | 'tone'> {
  /** The test's name as written in code. */
  name: string;
  /** The behavior it proves, in plain words. */
  proves: string;
  /** What the diff does to the test, drawn NEW, CHANGED or REMOVED. Defaults to "added". Use "existing" for an unchanged test that already covers the changed code. */
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
  /**
   * Your own panel titles, for a scene that is not about a diff's tests, e.g. { "cases": "Checks", "gaps": "Open questions" }.
   * Defaults: subject "Under test", proves "Proves", gaps "Not tested", none "No tests in this change" (shown when `cases` is empty).
   */
  titles?: { subject?: string; proves?: string; gaps?: string; none?: string };
  /**
   * Move the viewer's attention as the voice explains: the matrix draws first, then each step lights what
   * it focuses just before its `say` is spoken. `narration` is then the intro.
   * A ref is a case index (0-based), a case's name, or a gap "gap:0".
   */
  steps?: FocusStep[];
}

/** A cell's text, or `{ before, after }` for a value this change replaced: the old value is struck through beside the new one. */
export type TableCell = string | { before: string; after: string };

/**
 * One cell per column. An added or removed row holds plain text; a row with a `{ before, after }`
 * cell is modified, with or without `change: "modified"`. `badge` and `tone` label the row (see Marks).
 */
export type TableRow = Pick<Marks, 'badge' | 'tone'> & ({ cells: TableCell[]; change?: 'modified' } | { cells: string[]; change: 'added' | 'removed' });

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
   * Move the viewer's attention as the voice explains: each step lights what it focuses just before its
   * `say` is spoken while the rest dims. `narration` is then the intro. Replaces `highlight`.
   * A ref is a row index (0-based), a column "col:Header", or one cell "Header@row", e.g. "p99@2".
   */
  steps?: FocusStep[];
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
  /**
   * Move the viewer's attention as the voice explains: the whole chart draws first, then each step lights
   * what it focuses just before its `say` is spoken while the rest dims; the annotation appears with the
   * first step that focuses its point or label. `narration` is then the intro.
   * A ref is a label, a series "series:after", or one value "series@label", e.g. "after@p99".
   */
  steps?: FocusStep[];
}

export interface TimelineEvent extends Pick<Marks, 'highlight' | 'badge'> {
  /** Position on the axis, in the scene's unit. */
  at: number;
  label: string;
  /** A second, smaller line under the label. */
  detail?: string;
  tone?: Tone;
}

export interface TimelineSpan extends Pick<Marks, 'highlight' | 'badge'> {
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
  /** Revealed left to right. Up to 8. With `steps`, list them in order of `at`. */
  events: TimelineEvent[];
  /** Intervals drawn as bands under the axis, such as a wait, a window or a phase. Up to 4. */
  spans?: TimelineSpan[];
  /**
   * Walk the events in order, each step with its own words: the axis draws first, then the playhead moves
   * to the last event a step focuses, and what it focuses lights up, just before its `say` is spoken.
   * `narration` is then the intro. A ref is an event index (0-based), an inclusive "a-b" range of them,
   * or a span "span:label".
   */
  steps?: FocusStep[];
}

export interface FileEntry extends Pick<Marks, 'change' | 'badge' | 'tone'> {
  /** Repository-relative path. */
  path: string;
  /** What the diff does to the file. In a diff walkthrough defaults to what hunks.json says. */
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
   * Move the viewer's attention as the voice explains: each step lights the files it focuses just before
   * its `say` is spoken while the rest dims. `narration` is then the intro. Replaces `highlight`.
   * A ref is a path in the tree.
   */
  steps?: FocusStep[];
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
  /**
   * An explanation whose subject is itself a change, such as how a migration reshaped a table, so its
   * `change` marks are meant. Without it `validate` warns about every change mark in an explanation.
   * Set it on one scene instead when only that scene shows a change.
   */
  explainsChange?: boolean;
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
