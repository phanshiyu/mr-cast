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

/**
 * Text drawn on screen (labels, captions, bullets, notes, cells, actions, gaps, callouts, titles) never gets
 * cut: it wraps, then shrinks, and `validate` names any text that still does not fit. It may use inline
 * markup for the one word or value a sentence is about: `**bold**`, `` `code` `` (a monospace chip),
 * `==marked==` (a highlighter) and `[words]{tone}` with a Tone (good, bad, warn, accent, neutral). Bold and
 * code may sit inside a mark or a tone; nothing else nests. A backslash keeps * ` = [ ] { } literal. Code
 * names, file paths and test names are shown as written. Narration, `say` and pen notes stay plain.
 */
export type DisplayText = string;

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
  /**
   * The id of the plan.json topic this scene shows, when the run has a plan. `validate` checks each topic's scenes
   * against the pick in the storyboard's `plan`. Leave it off scenes about the whole video, such as the intent.
   */
  topic?: string;
  /** In an explanation, this scene explains a change, so its `change` marks are meant (see Storyboard.explainsChange). */
  explainsChange?: boolean;
  /**
   * Pre-read only (`--audience preread`): the ids of up to 3 hunks this diagram explains without showing them.
   * The scene names their files in a quiet "In the code:" line, and the reading order says "Explained in" this
   * chapter, which seeks the player to this scene. Put a cited hunk's file name or one of its identifiers
   * (`checkLimit`) in the scene's labels, so the viewer can map the picture onto the code; `validate` warns when
   * no label names it. The narration does not count. Give each scene that cites hunks its own `chapter`.
   */
  from?: string[];
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
 * A card in a graph or sequence scene: a service, a database, a person, a team, a document, a device.
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

/**
 * How a graph node is drawn: "card" (default) with an icon and caption; "decision" a diamond holding a
 * short question, whose outgoing edges' labels name the branches ("yes", "no"); "terminal" a pill for
 * where a flow starts or ends; "step" a plain box for an action, with no icon.
 */
export type NodeShape = 'card' | 'decision' | 'terminal' | 'step';

export interface GraphNode extends DiagramNode {
  /** Name of a group, e.g. "Support team". Nodes with the same group are drawn inside one labelled box. */
  group?: string;
  /** Defaults to "card". A decision, terminal or step draws no icon, and only a step draws a caption. */
  shape?: NodeShape;
}

export interface GraphEdge {
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

export interface GraphScene extends SceneBase {
  type: 'graph';
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * "LR" lays the graph out left to right; "TB" top to bottom, which suits hierarchies such as people and
   * teams, and flowcharts. Defaults to "TB" when a node is a decision, else "LR".
   */
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
  /**
   * Review mode: the id of the finding these lines show. The step draws a pen mark in the finding's colour, a
   * circle unless `mark` says otherwise, with `note` or else the finding's claim, under its severity. Say it then
   * and there as your opinion, in plain words, e.g. "I think this looks off. The order is saved without waiting, so a failed save goes unnoticed."
   */
  flag?: string;
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
  /**
   * The data as it looks after this step (JSON, a struct, a short code snippet...). In a pre-read, words with
   * the real names and values ("status pending, next try in 10 s"), since no code goes on screen.
   */
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

/**
 * How bad a review finding is: "bug" is wrong today, "risk" breaks under some input or later (a missing check,
 * an untested risky path, a leaked secret), "nit" is small but worth a fix (a confusing name, a typo).
 */
export type Severity = 'bug' | 'risk' | 'nit';

/**
 * Review mode: one thing in the diff that looks clearly wrong, the kind a reviewer reads and says "wait, that's
 * wrong". It is your opinion, so it is drawn apart from the explanation: a pen mark in its severity's colour
 * where a code step `flag`s it, and a row in the review scene. Check it against the code before adding it.
 */
export interface Finding {
  /** Named by a code step's `flag`, e.g. "unawaited-save". */
  id: string;
  severity: Severity;
  /** The file's path as the diff names it. */
  file: string;
  /** A new-file line or "a-b" range inside one of the file's hunks. */
  line: LineRef;
  /** What looks wrong, in one short line, e.g. "`save()` is never awaited". */
  claim: DisplayText;
  /** Why, in one short line: what the code does and an input that breaks it. Written to review.md, not drawn. */
  evidence: string;
}

/**
 * Review mode: a short recap of the storyboard's `findings` at the end of the video, grouped by severity, each
 * with its file:line and claim, under "Claude's review". Only when there are findings.
 */
export interface ReviewScene extends SceneBase {
  type: 'review';
  title?: string;
}

/** One hunk of the reading order. Its file and lines come from hunks.json, never typed. */
export interface ReadingItem {
  hunkId: string;
  /**
   * The lines that matter, "a-b" (or one line number), inside the hunk's own lines: reading.md, the terminal and
   * the scene point there instead of at the whole hunk. A new file's hunk is the whole file, so give it `lines`.
   */
  lines?: string | number;
  /**
   * What to verify there, in under 80 characters, with the real names and values, e.g. "the key resets on a
   * new minute; check the off-by-one". Required unless `routine`.
   */
  check?: DisplayText;
  /** A routine change (wiring, a rename, config): reading.md lists it on its group's one "skim" line, never on screen. */
  routine?: boolean;
  /** Review mode: the id of the finding whose line is in this hunk, drawn on the item in its severity's colour. */
  flag?: string;
}

/**
 * Pre-read only: the closing handoff, the order in which to read the code after the video, main behaviour
 * first. Lists every substantial hunk not in `skipped`. The scene shows the first 6 non-routine items under
 * "Read first" with their file:line and check, and counts the rest; reading.md, `mr-cast outline` and the
 * player's Reading order panel list them all. Narrate the first three and why they come first. In review
 * mode it also carries the findings, so a pre-read has no review scene.
 */
export interface ReadingScene extends SceneBase {
  type: 'reading';
  title?: string;
  items: ReadingItem[];
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

/** A component inside a layer, drawn as a card in its band: a page, a middleware, a service, a table. */
export type LayerItem = DiagramNode;

/** One horizontal band of a layers scene. */
export interface Layer extends Marks {
  /** Unique among every layer and item of the scene. */
  id: string;
  label: DisplayText;
  /** A short line under the label saying what the layer does, e.g. "checks the session". */
  caption?: DisplayText;
  /** Components inside the band, left to right. Up to 5. Their ids are unique across the scene. */
  items?: LayerItem[];
  /** Colour of the band's edge and badge. */
  tone?: Tone;
}

/** The way back from where a request is answered early, e.g. a rate limiter's 429. */
export interface LayerSkip {
  /** The stop that answers. The token turns back up there, and the stops after it are drawn as never reached. */
  at: string;
  /** What the token says on its way back up, e.g. "429 Too Many Requests". */
  reply: string;
  /** Colour of the reply. Defaults to "warn". */
  tone?: Tone;
}

/** A request travelling through the stack, drawn as a token that moves from stop to stop. */
export interface LayerPath {
  /** What the token says on its way down, e.g. "POST /orders". */
  label?: string;
  /**
   * Where the request goes, in order: layer ids, item ids, or "layer.item". Every stop sits at or below the
   * one before it, since the screen's order is the real order. List the whole way down even with `skip`.
   */
  stops: string[];
  /** After the last stop the token travels back up through the same stops to the first, carrying `reply`. */
  return?: boolean;
  /** What the token says on its way back up with `return`, e.g. "201 Created". */
  reply?: string;
  /** The request is answered early at `skip.at` and turns back there; the stops after it are skipped. */
  skip?: LayerSkip;
}

export interface LayersScene extends SceneBase {
  type: 'layers';
  title?: string;
  /** Top to bottom, in their real order: the outermost layer, or the first to see a request, on top. 2 to 7. */
  layers: Layer[];
  /** A request's way through the stack. */
  path?: LayerPath;
  /**
   * Move the viewer's attention as the voice explains: the stack draws first, then each step lights what it
   * focuses just before its `say` is spoken while the rest dims. `narration` is then the intro.
   * A ref is a layer id, an item id or "layer.item", or a path stop index (0-based). A step that focuses
   * a stop moves the token there; it only moves on along its path, so walk the stops in order, and with
   * `return` or `skip` focus a stop again to bring it back up; where it turns back at the first stop, focus
   * that stop twice. Without steps the token walks the whole path
   * while the narration plays.
   */
  steps?: FocusStep[];
}

/** A value an `array` cell, a `memory` variable or a field holds, drawn as display text. */
export type StateValue = DisplayText | number;

/**
 * What a step of an `array` or `memory` scene changes. Each change lands at the step's start, so the viewer
 * sees it settle before the step's words: a changed value slides out and the new one in, briefly lit; a moved
 * pointer slides to its cell. The scene shows its initial state during `narration`, and at each step that
 * state with every change of the steps up to and including it applied in order.
 * A step without `focus` focuses what it sets, moves or shows; a step that only hides needs a `focus`.
 */
export interface StateStep extends Omit<FocusStep, 'focus'> {
  focus?: FocusStep['focus'];
  /** Items to show from this step on, by focus ref, such as "ptr:mid" or an object id. */
  show?: string[];
  /** Items to hide from this step on, such as a frame that returned ("frame:helper"). */
  hide?: string[];
}

export interface ArrayPointer {
  /** A short name such as "lo", "hi", "mid", "head" or "cursor", drawn above its cell with an arrow. Pointers on one cell stack. */
  name: string;
  /** Cell index it points at; -1 or the array's length point just past either end, as a loop that ran off it. */
  at: number;
  tone?: Tone;
  /** Not drawn until a step shows it ("show": ["ptr:mid"]). */
  hidden?: boolean;
}

export interface ArrayRange {
  /** What the span is, such as "window", "page 2" or "seen", drawn on a shaded band under the cells. */
  name: string;
  /** First and last cell index it covers, inclusive. */
  from: number;
  to: number;
  tone?: Tone;
  hidden?: boolean;
}

export interface ArrayStep extends StateStep {
  /** New cell values by cell index, e.g. { "3": 42 }. */
  set?: Record<string, StateValue>;
  /** New places: a pointer's name to a cell index, e.g. { "lo": 4 }, and a range's name to "a-b", e.g. { "window": "2-5" }. */
  move?: Record<string, number | string>;
}

/**
 * A row of cells with their indexes under them, for an algorithm or a buffer walked step by step: binary
 * search, a sliding window, a pagination cursor, a ring buffer, a queue, an off-by-one bug.
 */
export interface ArrayScene extends SceneBase {
  type: 'array';
  title?: string;
  /** The array's name, such as "nums" or "buffer", drawn above it. */
  label?: string;
  /** Each cell's value, left to right. Up to 16. An empty string draws an empty cell. */
  values: StateValue[];
  /** Named markers on cells. Up to 4. Pointer and range names are all different. */
  pointers?: ArrayPointer[];
  /** Shaded spans of cells. Up to 3. */
  ranges?: ArrayRange[];
  /**
   * Walk the algorithm: each step changes what it `set`s, `move`s, `show`s and `hide`s at its start, then
   * lights its focus while its `say` is spoken. `narration` is the intro over the initial state.
   * A ref is a cell index, an "a-b" range of cells, a pointer "ptr:lo", or a range "range:window".
   */
  steps?: ArrayStep[];
}

/** A memory value: display text, a number, or `{ "ref": "<object id>" }`, drawn as an arrow to that object. */
export type MemoryValue = StateValue | { ref: string };

export interface MemoryFrame {
  /** The function's name, e.g. "main" or "add_item". Different for every frame; a recursive call reads "fact(2)". */
  name: string;
  /** Its local variables in order, name to value, e.g. { "cart": { "ref": "c1" }, "total": 0 }. */
  vars: Record<string, MemoryValue>;
  /** Not drawn until a step shows it ("show": ["frame:add_item"]), as a call. */
  hidden?: boolean;
}

export interface MemoryObject {
  /** Named by refs and steps, e.g. "c1". Different from every frame name. */
  id: string;
  /** What it is, e.g. "list", "dict", "Cart", drawn as its header. Defaults to the id. */
  type?: string;
  /** Its fields or items in order, name to value; a list's are "0", "1", ... */
  fields: Record<string, MemoryValue>;
  /** Not drawn until a step shows it, as an object created then. */
  hidden?: boolean;
}

export interface MemoryStep extends StateStep {
  /** New values by "frame.var" or "object.field", e.g. { "main.total": 3, "add_item.items": { "ref": "l2" } }. */
  set?: Record<string, MemoryValue>;
}

/**
 * A program's memory: call frames with their local variables on the left, objects on the right. A variable
 * or field that holds a `{ "ref": id }` draws an arrow to that object, so two arrows into one object show
 * aliasing. For mutation and aliasing bugs, references versus copies, closures, what a handler holds.
 */
export interface MemoryScene extends SceneBase {
  type: 'memory';
  title?: string;
  /** Call frames, outermost first. Up to 4. */
  frames: MemoryFrame[];
  /** Up to 6. List every object a step creates too, `hidden` until then. */
  objects: MemoryObject[];
  /**
   * Walk the program: each step changes what it `set`s, `show`s and `hide`s at its start, then lights its
   * focus while its `say` is spoken. Setting a reference re-routes its arrow. `narration` is the intro.
   * A ref is a frame "frame:main", a variable "main.cart", an object id, or a field "c1.items".
   */
  steps?: MemoryStep[];
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

/** One side's cell in a compare row: display text, or a short code snippet of a few lines drawn with syntax colours. */
export type CompareCell = DisplayText | { code: string; lang?: string };

/** Which side of a compare row is better: a green check, a red cross, or an amber warning on that side's cell. */
export type Verdict = 'good' | 'bad' | 'warn';

export interface CompareSide {
  /** E.g. "Before", "After", "Option A", "Redis", "Without the cache". */
  title: string;
  /** Colour of the side's title and frame. Defaults to neutral for the first side and accent for the second. */
  tone?: Tone;
}

export interface CompareRow {
  /** The aspect the row compares, e.g. "On Redis outage", drawn in a column left of both sides. */
  label?: DisplayText;
  /** Exactly two, one per side, left then right. */
  cells: CompareCell[];
  /**
   * true for a row that is the same on both sides: it dims, with "=" between the sides. Defaults to whether
   * the two cells are equal. A row that differs gets an arrow between the sides, so the change is explicit.
   */
  same?: boolean;
  /** Which side is better on this row, one entry per side, null for no verdict, e.g. ["bad", "good"]. */
  verdict?: (Verdict | null)[];
}

/**
 * Two things side by side, row by row, in the same layout so the eye compares like with like: old and new
 * behaviour, an API or config shape, two designs, what the user sees before and after. Matching rows sit at
 * the same height on both sides. The frames and titles draw first, then the rows top to bottom.
 */
export interface CompareScene extends SceneBase {
  type: 'compare';
  title?: string;
  /** The two sides, left then right. Defaults to "Before" and "After". */
  sides?: CompareSide[];
  /** Up to 6. */
  rows: CompareRow[];
  /**
   * Walk the rows in order, each step with its own words: the frames draw first, then each step's rows show
   * and light up just before its `say` is spoken. `narration` is then the intro. A ref is a row index
   * (0-based), an inclusive "a-b" range of them, a side "side:0" or "side:After" (by title), or one cell
   * "row@side", e.g. "2@After" or "2@1". A step shows every row up to the last one it names, so name them in order.
   */
  steps?: FocusStep[];
}

/** One command and what it printed. Give a `command`, an `output`, or both. */
export interface TerminalEntry {
  /** Typed out character by character after the prompt. Shown exactly as written. */
  command?: string;
  /**
   * What it printed, lines separated by "\n". Long lines wrap. Markup colours a line or a word, e.g.
   * "[FAIL]{bad} src/limit.test.ts" or "[✓ 12 passed]{good}"; write \` and \* for a literal backtick or star.
   */
  output?: DisplayText;
  /** The prompt before the command. Defaults to "$". */
  prompt?: string;
  /** The command's exit status, shown at the entry's end: green for 0, and any other value tints the entry red. */
  exit?: number;
}

/**
 * A shell session: commands type out, then their output appears. For repro steps, running a migration, a
 * failing then passing test run, CLI behaviour before and after, or logs. Text stays a readable size; a
 * session taller than the frame scrolls, the camera following the steps.
 */
export interface TerminalScene extends SceneBase {
  type: 'terminal';
  title?: string;
  /** The window's title bar, e.g. "zsh: ~/app". */
  window?: string;
  /** In order. Without steps they play out while the narration speaks. */
  entries: TerminalEntry[];
  /**
   * Walk the session, each step with its own words: each step types the entries up to the last one it names
   * and lights what it names just before its `say` is spoken. `narration` is then the intro. A ref is an entry
   * index (0-based), an inclusive "a-b" range of them, or one output line "entry:line", e.g. "2:3" for line 3
   * (0-based) of entry 2's output. Name the entries in order.
   */
  steps?: FocusStep[];
}

export type Scene = IntentScene | GraphScene | CodeScene | FlowScene | SequenceScene | ErScene | StateScene | MermaidScene | TestsScene | TableScene | ChartScene | TimelineScene | FilesScene | ReviewScene | ReadingScene | CompareScene | TerminalScene | LayersScene | ArrayScene | MemoryScene;

export interface Storyboard {
  title: string;
  subtitle?: string;
  scenes: Scene[];
  /**
   * Review mode only, when the user asked for your review: what looks wrong in the diff. `[]` says you looked and
   * found nothing. Left out, the video only explains. `validate` writes them to review.md beside the video.
   */
  findings?: Finding[];
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
  /**
   * With a plan.json only: the pick each topic's scenes were written from, by topic id, copied from plan.json
   * (the topic's `choice`, else its `depth` and first view), such as `{ "rate-limiter": { "depth": "brief",
   * "view": "calls" } }`. Update a topic's entry whenever you rewrite its scenes. `validate` checks each topic's
   * scenes against it, warns when a pick in plan.json has changed since, and records it as what the video was
   * built from, so the plan page marks every topic whose pick differs.
   */
  plan?: Record<string, TopicPick>;
}

export interface SkippedHunk {
  hunkId: string;
  reason: string;
}

// ─── plan.json (written by the LLM; the plan page writes each topic's `choice`) ─

/** How much of the video a topic gets: none, its view and the key lines, or its view and then the code line by line. */
export type Depth = 'skip' | 'brief' | 'deep';

/** A way to show a topic, keyed in shared/views.mjs, which holds its plain label and the scene types that draw it. */
export type ViewKey = 'parts' | 'calls' | 'data' | 'decisions' | 'states' | 'layers' | 'schema' | 'compare' | 'timing' | 'facts' | 'numbers' | 'shell' | 'memory' | 'steps' | 'code';

/** What the video does with a topic. */
export interface TopicPick {
  depth: Depth;
  view: ViewKey;
}

export interface PlanTopic {
  /** A stable slug, such as "rate-limiter". Scenes name it in their `topic`. */
  id: string;
  title: string;
  /** What the topic covers, in one line. */
  summary: string;
  files: string[];
  /** The suggested depth. */
  depth: Depth;
  /** 1 to 3 ways to show it, the suggested one first. */
  views: ViewKey[];
  /** One line on why the suggested view fits. */
  why?: string;
  /** About how long the topic takes at each depth. */
  seconds: { brief: number; deep: number };
  /** The viewer's pick, written by the plan page. Absent means the suggestion. */
  choice?: TopicPick;
}

export interface Plan {
  topics: PlanTopic[];
}

// ─── voiceover.json (written by `mr-cast voice`) ─────────────────────────────

export interface VoiceClip {
  /** WAV path relative to the .mr-cast directory, e.g. "audio/1a2b3c4d.wav". */
  src: string;
  seconds: number;
  /** When each sentence is spoken, so captions follow the voice through the pauses between sentences. */
  sentences?: VoiceSentence[];
  /** The voice and speed it was made in; the file keeps clips of other voices and speeds too. */
  voice?: string;
  speed?: number;
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
  /** Set by `play` until its first voicing ends; the player waits for the voice and reloads when it is ready. */
  pending?: boolean;
  /** Set by `play` when voicing failed, so the player says so; the scenes are then timed for reading. */
  failed?: boolean;
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
