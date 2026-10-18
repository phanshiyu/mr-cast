import { useMemo } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { headerBox } from '../fit/shell';
import type { ImageScene } from '../types';
import { cameraFor, layoutImage, regionOnScreen, viewAt } from '../utils/imageLayout';
import type { MarkTargets } from '../utils/penGeometry';
import { imageTargets } from '../utils/sceneTargets';
import { focusSpotlight } from '../utils/spotlight';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { Picture, useImages } from './Picture';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors } from './theme';

const DIM = 0.58;
const RADIUS = 18;

/**
 * A picture in a frame, with its caption and credit under it, a slow pan and zoom when `kenBurns` asks, and the
 * regions steps light: the rest of the picture darkens and the lit region gets an outline and its label.
 */
export const ImageFrame: React.FC<SceneProps<ImageScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const images = useImages();
  const box = headerBox(scene);
  const layout = useMemo(() => layoutImage(scene, box, images), [scene, box.width, box.height, images]);
  const cameraAt = (f: number) => cameraFor(layout, viewAt(scene, f / Math.max(1, durationInFrames)));
  const camera = cameraAt(frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const firstStep = segments[1]?.from;
  const dim = firstStep === undefined ? 0 : interpolate(frame, [firstStep, firstStep + 14], [0, 1], clamp);
  const appear = interpolate(frame, [0, 18], [0, 1], clamp);
  const { frame: area, base } = layout;
  const regions = (scene.regions ?? []).map((r) => ({ region: r, at: regionOnScreen(layout, r.box, camera), lit: focus(`im:${r.id}`).glow }));
  // Ink lands where each step's region is as the step's pen starts.
  const marks = (k: number): MarkTargets => imageTargets(scene, images, [(segments[k + 1]?.markFrom ?? 0) / Math.max(1, durationInFrames)])[0]!;
  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: marks }}>
      <div
        style={{
          position: 'absolute',
          left: area.x,
          top: area.y,
          width: area.width,
          height: area.height,
          borderRadius: RADIUS,
          overflow: 'hidden',
          background: colors.raised,
          boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
          opacity: appear,
        }}
      >
        <Picture
          src={scene.src}
          fit="fill"
          style={{ position: 'absolute', left: camera.left - area.x, top: camera.top - area.y, width: base.width * camera.zoom, height: base.height * camera.zoom }}
        />
        {dim > 0 ? (
          <svg width={area.width} height={area.height} style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <mask id="image-spotlight">
                <rect x={0} y={0} width={area.width} height={area.height} fill="white" />
                {regions.map(({ region, at, lit }) => (
                  <rect key={region.id} x={at.x - area.x} y={at.y - area.y} width={at.width} height={at.height} rx={12} fill="black" fillOpacity={lit} />
                ))}
              </mask>
            </defs>
            <rect x={0} y={0} width={area.width} height={area.height} fill="#000" opacity={DIM * dim} mask="url(#image-spotlight)" />
          </svg>
        ) : null}
      </div>
      {regions.map(({ region, at, lit }) =>
        lit > 0 ? (
          <div key={region.id} style={{ position: 'absolute', left: at.x, top: at.y, width: at.width, height: at.height, opacity: lit }}>
            <div style={{ position: 'absolute', inset: -3, borderRadius: 14, border: `3px solid ${colors.accent}`, boxShadow: `0 0 32px ${colors.accentGlow}` }} />
            {layout.labels.get(region.id) ? (
              <div
                style={{
                  position: 'absolute',
                  left: -3,
                  bottom: at.y > 60 ? '100%' : undefined,
                  top: at.y > 60 ? undefined : '100%',
                  margin: '10px 0',
                  padding: '6px 14px',
                  borderRadius: 10,
                  background: colors.accent,
                  whiteSpace: 'nowrap',
                }}
              >
                <FitText fit={layout.labels.get(region.id)!} style={{ color: colors.bg }} />
              </div>
            ) : null}
          </div>
        ) : null,
      )}
      {layout.caption ? <FitText fit={layout.caption} style={{ position: 'absolute', left: area.x, top: layout.captionTop, width: area.width * 0.8, color: colors.text, opacity: appear }} /> : null}
      {layout.credit ? <FitText fit={layout.credit} align="right" style={{ position: 'absolute', right: box.width - area.x - area.width, top: layout.captionTop + 4, color: colors.faint, opacity: appear }} /> : null}
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={marks} />
    </SceneShell>
  );
};
