import type { CodeStep, Finding, PenMark, Severity, Storyboard } from '../src/types';

/** Severities, worst first: the order the review scene and review.md list them in. */
export declare const SEVERITIES: readonly Severity[];
export declare const SEVERITY_TITLES: Record<Severity, string>;
/** The mark a flagged step draws when it names none. */
export declare const FLAG_MARK: PenMark;
export declare function isReviewed(storyboard: Storyboard): boolean;
/** The finding a code step flags, or undefined. */
export declare function flaggedFinding(storyboard: Storyboard, step: CodeStep): Finding | undefined;
/** "src/a.ts:12" or "src/a.ts:12-14". */
export declare function findingLocation(finding: Finding): string;
/** The findings worst first, keeping the written order within a severity. */
export declare function bySeverity(findings: readonly Finding[]): Finding[];
/** review.md: the findings as file:line bullets a reader can act on, with their evidence. */
export declare function reviewMarkdown(storyboard: Storyboard, run?: { branch?: string; base?: string }): string;
