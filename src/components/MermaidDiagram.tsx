import type { Mermaid } from 'mermaid';
import { useEffect, useId, useState } from 'react';
import { interpolate, spring, useCurrentFrame, useDelayRender, useVideoConfig } from 'remotion';
import type { MermaidScene } from '../types';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, fonts } from './theme';

/** Mermaid lays text out at 16px; past this, small diagrams look blown up rather than legible. */
const MAX_UPSCALE = 1.9;

type Rendered =
  | { status: 'loading' }
  | { status: 'ready'; svg: string; width: number; height: number }
  | { status: 'error'; message: string };

const surfaces = { node: '#1c2033', alt: '#161a26', deep: '#11131c', line: '#aab2c8', edge: '#3a3f52', amber: '#fbbf24' };
const palette = [colors.accent, colors.add, surfaces.amber, colors.del, '#5ec8f2', '#c084fc', '#f472b6', '#a3e635'];

let mermaidReady: Promise<Mermaid> | null = null;

/** Mermaid is large, so it loads only when a mermaid scene mounts, and is configured once. */
function loadMermaid(): Promise<Mermaid> {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      fontFamily: fonts.sans,
      gantt: { useWidth: 1000, fontSize: 16, sectionFontSize: 16, barHeight: 34, barGap: 8 },
      themeVariables: {
        darkMode: true,
        fontFamily: fonts.sans,
        fontSize: '16px',
        background: colors.bg,
        textColor: colors.text,
        titleColor: colors.text,
        lineColor: surfaces.line,
        primaryColor: surfaces.node,
        primaryTextColor: colors.text,
        primaryBorderColor: colors.accent,
        secondaryColor: surfaces.alt,
        secondaryTextColor: colors.text,
        secondaryBorderColor: surfaces.edge,
        tertiaryColor: surfaces.deep,
        tertiaryTextColor: colors.text,
        tertiaryBorderColor: surfaces.edge,
        mainBkg: surfaces.node,
        nodeBorder: colors.accent,
        clusterBkg: surfaces.deep,
        clusterBorder: surfaces.edge,
        edgeLabelBackground: '#0d0f16',
        noteBkgColor: '#2a2414',
        noteTextColor: colors.text,
        noteBorderColor: surfaces.amber,
        sectionBkgColor: surfaces.alt,
        altSectionBkgColor: colors.bg,
        sectionBkgColor2: surfaces.alt,
        gridColor: surfaces.edge,
        taskBkgColor: '#2b3360',
        taskBorderColor: colors.accent,
        taskTextColor: colors.text,
        taskTextLightColor: colors.text,
        taskTextOutsideColor: colors.text,
        taskTextDarkColor: colors.text,
        activeTaskBkgColor: colors.accent,
        activeTaskBorderColor: colors.accent,
        doneTaskBkgColor: '#1f4a3a',
        doneTaskBorderColor: colors.add,
        critBkgColor: '#4a1f27',
        critBorderColor: colors.del,
        todayLineColor: colors.del,
        pieOpacity: '0.92',
        pieStrokeColor: colors.bg,
        pieOuterStrokeColor: surfaces.edge,
        pieTitleTextColor: colors.text,
        pieSectionTextColor: colors.bg,
        pieLegendTextColor: colors.text,
        ...Object.fromEntries(palette.map((c, i) => [`pie${i + 1}`, c])),
        // mindmap, timeline and other section-coloured diagrams
        ...Object.fromEntries(palette.map((c, i) => [`cScale${i}`, c])),
        ...Object.fromEntries(palette.map((_, i) => [`cScaleLabel${i}`, colors.bg])),
        ...Object.fromEntries(palette.map((c, i) => [`git${i}`, c])),
        ...Object.fromEntries(palette.map((_, i) => [`gitBranchLabel${i}`, colors.bg])),
        commitLabelColor: colors.text,
        commitLabelBackground: surfaces.node,
        classText: colors.text,
        labelColor: colors.text,
        attributeBackgroundColorOdd: surfaces.alt,
        attributeBackgroundColorEven: surfaces.deep,
      },
    });
    return mermaid;
  });
  mermaidReady.catch(() => {
    mermaidReady = null;
  });
  return mermaidReady;
}

/** Reads the diagram's natural size and lets the SVG fill whatever box it is given. */
function sizedSvg(svgText: string): { svg: string; width: number; height: number } {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement;
  const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (!width || !height) throw new Error('Mermaid produced a diagram with no size');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.removeProperty('max-width');
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.trim() || 'Unknown Mermaid error';
}

const ErrorCard: React.FC<{ message: string }> = ({ message }) => {
  const [first, ...rest] = message.split('\n');
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        margin: 'auto',
        width: 1200,
        height: 'fit-content',
        boxSizing: 'border-box',
        padding: '40px 48px',
        borderRadius: 24,
        background: colors.surface,
        border: `2px solid ${colors.del}`,
        boxShadow: `0 0 0 6px ${colors.delBg}`,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: colors.del }}>Mermaid diagram failed to render</div>
      <div style={{ fontSize: 32, fontWeight: 650, marginTop: 16, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{first}</div>
      {rest.length ? (
        <pre style={{ margin: '24px 0 0', fontFamily: fonts.mono, fontSize: 20, lineHeight: 1.45, color: colors.muted, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden', maxHeight: 220 }}>
          {rest.join('\n')}
        </pre>
      ) : null}
    </div>
  );
};

export const MermaidDiagram: React.FC<SceneProps<MermaidScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { delayRender, continueRender } = useDelayRender();
  // useId's colons and guillemets are not valid in the CSS selectors Mermaid scopes its styles with.
  const id = `mermaid-${useId().replace(/[^\w-]/g, '')}`;
  const [rendered, setRendered] = useState<Rendered>({ status: 'loading' });

  useEffect(() => {
    const handle = delayRender(`Rendering Mermaid diagram ${id}`);
    let settled = false;
    const settle = (next: Rendered) => {
      if (settled) return;
      settled = true;
      setRendered(next);
      continueRender(handle);
    };
    setRendered({ status: 'loading' });
    // A bad diagram becomes an error card instead of cancelRender, so one scene cannot fail a whole video.
    loadMermaid()
      .then((mermaid) => mermaid.render(id, scene.code))
      .then(({ svg }) => settle({ status: 'ready', ...sizedSvg(svg) }))
      .catch((err: unknown) => settle({ status: 'error', message: errorMessage(err) }));
    return () => {
      if (settled) return;
      settled = true;
      continueRender(handle);
    };
  }, [scene.code, id, delayRender, continueRender]);

  const box = contentBox(Boolean(scene.title));
  const enter = spring({ frame: frame - 4, fps, config: { damping: 200 } });

  let body: React.ReactNode = null;
  if (rendered.status === 'error') body = <ErrorCard message={rendered.message} />;
  if (rendered.status === 'ready') {
    const scale = Math.min(box.width / rendered.width, box.height / rendered.height, MAX_UPSCALE);
    body = (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          margin: 'auto',
          width: rendered.width * scale,
          height: rendered.height * scale,
          opacity: enter,
          transform: `scale(${interpolate(enter, [0, 1], [0.94, 1], clamp)})`,
        }}
        dangerouslySetInnerHTML={{ __html: rendered.svg }}
      />
    );
  }

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.mermaid} title={scene.title}>
      {body}
    </SceneShell>
  );
};
