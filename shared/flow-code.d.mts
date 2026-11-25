import type { FlowCode, Hunk } from '../src/types';

export declare function parseSpan(ref: unknown): [number, number] | null;
export declare function codeRows(
  hunk: Hunk,
  code: FlowCode,
): { problem: string | null; rows: { index: number; lit: boolean }[]; first: number | null };
export declare function codeHunkId(code: FlowCode | undefined): string | undefined;
export declare function formatPayload(payload: string): { text: string; language: string };
