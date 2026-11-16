export const ADAPTIVE_EXECUTION_POLICY: Readonly<Record<string, any>>;
export function readAvailableHostMemory(options?: { freeMemoryBytes?: number; totalMemoryBytes?: number; availableMemoryBytes?: number | null }): {
  freeMemoryBytes: number; totalMemoryBytes: number; availableMemoryBytes: number; availableMemorySource: string;
};
export function createAdaptiveResourceSampler(): (state?: { inFlight?: number }) => any;
export function runAdaptiveSlotQueue(slots: any[], options: {
  run: (slot: any, index: number, feedback: (signal: any) => Promise<void>) => Promise<any>;
  sampleResources?: (state: any) => any | Promise<any>;
  initialConcurrency?: number | ((resources: any) => number);
  resourceCapacity?: number | ((resources: any, state: any) => number);
  onEvent?: (event: any) => any;
  onCheckpoint?: (outcomes: any[], state: any) => Promise<void>;
  shouldStopOnError?: (error: any, slot: any, index: number) => boolean;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<any>;
}): Promise<{ outcomes: any[]; failures: any[]; schedulingEvents: any[]; slotTimings: any[]; stopReason: string | null; policy: any }>;
