import type { Depth, Plan, PlanTopic, TopicPick } from '../src/types';

export declare const DEPTHS: Depth[];
export declare function suggestionOf(topic: PlanTopic): TopicPick;
export declare function pickOf(topic: PlanTopic): TopicPick;
export declare function samePick(a: TopicPick | undefined, b: TopicPick | undefined): boolean;
export declare function choiceError(topic: PlanTopic, choice: unknown): string | null;
export declare function checkPlan(
  plan: unknown,
  options?: { preread?: boolean },
): { errors: string[]; warnings: string[] };
export declare function planSeconds(plan: Plan): number;
export declare function formatLength(seconds: number): string;
