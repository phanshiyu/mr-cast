import { useMemo, type ReactNode } from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { cameraShots, frameShot, tweenView, viewTransform, type View } from '../../shared/camera.mjs';
import { SCENE_EXIT_FRAMES as EXIT_FRAMES } from '../../shared/timing.mjs';
import { headerBox, shellFits } from '../fit/shell';
import type { HunkMap, Scene } from '../types';
import type { MarkTargets } from '../utils/penGeometry';
import { currentStep, stepMove } from '../utils/spotlight';
import type { SpokenSegment } from '../utils/timing';
import { FitText } from './FitText';
import { SAFE, clamp, colors, fonts } from './theme';

const ENTER_FRAMES = 12;
/** How far past the content box a camera's view still paints, in px, as far as a drawing's glow bleeds; it fades out there. */
const CAMERA_BLEED = 32;
const fade = (side: string) => `linear-gradient(to ${side}, transparent, #000 ${CAMERA_BLEED}px, #000 calc(100% - ${CAMERA_BLEED}px), transparent)`;
const EDGE_FADE = {
  maskImage: `${fade('right')}, ${fade('bottom')}`,
  maskComposite: 'intersect',
  WebkitMaskImage: `${fade('right')}, ${fade('bottom')}`,
  WebkitMaskComposite: 'source-in',
} as const;

/** What a scene's camera frames: the boxes it gives its pen at each step, which the camera follows as they move. */
export interface CameraSource {
  hunks: HunkMap;
  segments: readonly SpokenSegment[];
  targets: (step: number) => MarkTargets | null;
}

interface SceneShellProps {
  scene: Scene;
  durationInFrames: number;
  /** Rendered at the right end of the header row. */
  aside?: ReactNode;
  /** Steps with a `camera` zoom and pan the content, its ink and pen marks with it. */
  camera?: CameraSource;
  children: ReactNode;
}

/** Where a scene's camera looks this frame, or null when no step moves it. */
export function useCameraView(scene: Scene, source: CameraSource): View | null {
  const frame = useCurrentFrame();
  const { shots, moves } = useMemo(() => cameraShots(scene, source.hunks), [scene, source.hunks]);
  if (!moves) return null;
  const area = headerBox(scene);
  const viewAt = (state: number) => {
    const t = state > 0 ? source.targets(state - 1) : null;
    return frameShot(shots[state] ?? null, (key) => t?.boxes.get(key) ?? t?.boxOf?.(key) ?? null, area);
  };
  const k = currentStep(source.segments, frame);
  return k < 0 || !source.segments[k + 1] ? viewAt(0) : tweenView(viewAt(k), viewAt(k + 1), stepMove(frame, source.segments[k + 1]!.from));
}

/** The content as a step's camera shows it, easing to each step's shot as the step starts. A scene whose pen targets live
 * below SceneShell, such as code's, wraps its content in it there. */
export const Camera: React.FC<{ scene: Scene; source: CameraSource; children: ReactNode }> = ({ scene, source, children }) => {
  const view = useCameraView(scene, source);
  if (!view) return <>{children}</>;
  const area = headerBox(scene);
  return (
    <div style={{ position: 'absolute', inset: -CAMERA_BLEED, ...EDGE_FADE }}>
      <div style={{ position: 'absolute', inset: CAMERA_BLEED, transformOrigin: '0 0', transform: viewTransform(view, area) }}>{children}</div>
    </div>
  );
};

/** A scene's frame: its chapter label and title, an optional aside, and its content below. */
export const SceneShell: React.FC<SceneShellProps> = ({ scene, durationInFrames, aside, camera, children }) => {
  const frame = useCurrentFrame();
  const exitStart = Math.max(ENTER_FRAMES, durationInFrames - EXIT_FRAMES);
  const opacity = interpolate(frame, [0, ENTER_FRAMES, exitStart, durationInFrames], [0, 1, 1, 0], clamp);
  const y = interpolate(frame, [0, ENTER_FRAMES], [28, 0], clamp) + interpolate(frame, [exitStart, durationInFrames], [0, -16], clamp);
  const { eyebrow, title } = shellFits(scene);

  return (
    <AbsoluteFill
      style={{
        padding: `${SAFE.top}px ${SAFE.right}px ${SAFE.bottom}px ${SAFE.left}px`,
        opacity,
        transform: `translateY(${y}px)`,
        fontFamily: fonts.sans,
        color: colors.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, marginBottom: 36, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FitText fit={eyebrow} style={{ color: colors.accent, lineHeight: 'normal' }} />
          {title ? <FitText fit={title} style={{ marginTop: 10, lineHeight: 'normal' }} /> : null}
        </div>
        {aside}
      </div>
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{camera ? <Camera scene={scene} source={camera}>{children}</Camera> : children}</div>
    </AbsoluteFill>
  );
};
