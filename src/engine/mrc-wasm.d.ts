// The browser build of the engine (engine/wasm), which scripts/build-wasm.mjs writes to engine/wasm/pkg and vite
// resolves as `mrc-wasm`. Declared here so typechecking does not need the build; keep it in step with
// engine/wasm/src/lib.rs.
declare module 'mrc-wasm' {
  export class Player {
    constructor(props: string);
    free(): void;
    totalFrames(): number;
    scenes(): Float64Array;
    chapters(): string;
    fingerprint(frame: number): bigint;
    render(frame: number, scale: number): boolean;
    width(): number;
    height(): number;
    pixelsPtr(): number;
  }
  export default function init(): Promise<{ memory: WebAssembly.Memory }>;
}
