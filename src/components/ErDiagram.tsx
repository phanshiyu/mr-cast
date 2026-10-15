import { KeyRound, Link2, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { Change, ErField, ErRelation, ErScene } from '../types';
import { HEADER_H, ROW_H, layoutEr, normal, type PlacedEntity, type RelationEnd, type RoutedRelation } from '../utils/erLayout';
import { brighter, focusSpotlight, asBrightAs, type Emphasis } from '../utils/spotlight';
import { CHANGE_WORD } from '../utils/marks';
import { Badge, badgesOf, EMPHASIS, emphasisRing, type BadgeSpec } from './marks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, ellipsis, fitFontSize, fonts } from './theme';

const AMBER = '#fbbf24';
const AMBER_BG = 'rgba(251, 191, 36, 0.13)';
const EDGE = 'rgba(170, 178, 200, 0.7)';
const CARD_START = 8;
const CARDS_END = 18;
const RELATION_FRAMES = 12;
/** Frames after a card starts landing that its changed fields light up. */
const FIELDS_AFTER = 10;

/** Field rows mark a change in amber, so a changed field stands apart from its changed (blue) table. */
const changeTone: Record<Change, { color: string; bg: string; marker: string }> = {
  added: { color: colors.add, bg: colors.addBg, marker: '+' },
  removed: { color: colors.del, bg: colors.delBg, marker: '−' },
  modified: { color: AMBER, bg: AMBER_BG, marker: '~' },
};

/** Frames at which each part of the scene arrives; all of it inside the build. */
interface Timeline {
  cardAt: (index: number) => number;
  relationAt: (index: number) => number;
  /** Highlight moment per changed field, keyed `${entityId}/${fieldIndex}`. */
  fieldAt: Map<string, number>;
}

function buildTimeline(layout: ReturnType<typeof layoutEr>): Timeline {
  const cardOrder = [...layout.entities].sort((a, b) => a.row - b.row || a.col - b.col);
  const cardRank = new Map(cardOrder.map((p, i) => [p.entity.id, i]));
  const cardStagger = Math.min(6, (CARDS_END - CARD_START) / Math.max(1, layout.entities.length - 1));
  const cardAt = (id: string) => CARD_START + cardRank.get(id)! * cardStagger;
  const relationsStart = CARDS_END + 6;
  const relationOrder = layout.relations.map((_, i) => i).sort((a, b) => Number(!!layout.relations[a]!.relation.change) - Number(!!layout.relations[b]!.relation.change));
  const relationRank = new Map(relationOrder.map((r, i) => [r, i]));
  const relationStagger = Math.min(5, (buildFrames('er') - relationsStart - RELATION_FRAMES - 4) / Math.max(1, layout.relations.length - 1));
  const changed = layout.entities.flatMap((p) => p.entity.fields.flatMap((f, i) => (f.change ? [{ key: `${p.entity.id}/${i}`, at: cardAt(p.entity.id) + FIELDS_AFTER }] : [])));
  return {
    cardAt: (index) => cardAt(layout.entities[index]!.entity.id),
    relationAt: (index) => relationsStart + relationRank.get(index)! * relationStagger,
    fieldAt: new Map(changed.map(({ key, at }) => [key, at])),
  };
}

const Pills: React.FC<{ badges: readonly BadgeSpec[]; scale: number }> = ({ badges, scale }) => (
  <div style={{ position: 'absolute', top: -15, right: 18, display: 'flex', gap: 6, transform: `scale(${scale})` }}>
    {badges.map((b, i) => (
      <Badge key={i} badge={b} size={15} style={{ padding: '3px 12px' }} />
    ))}
  </div>
);

const FieldRow: React.FC<{ field: ErField; index: number; at: number | undefined; frame: number; dimmed: boolean; lit: number }> = ({
  field,
  index,
  at,
  frame,
  dimmed,
  lit,
}) => {
  const tone = field.change ? changeTone[field.change] : null;
  const on = at === undefined ? 0 : interpolate(frame, [at, at + 10], [0, 1], clamp);
  const pulse = at === undefined ? 0 : interpolate(frame, [at, at + 6, at + 30], [0, 1, 0], clamp);
  const slide = field.change === 'added' ? on : 1;
  const struck = field.change === 'removed' ? interpolate(frame, [(at ?? 0) + 2, (at ?? 0) + 14], [0, 1], clamp) : 0;
  const Icon = field.pk ? KeyRound : field.fk ? Link2 : null;
  const nameColor = field.change === 'removed' ? `rgba(242,244,248,${1 - 0.45 * struck})` : colors.text;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: HEADER_H + index * ROW_H,
        height: ROW_H,
        borderTop: index === 0 ? 'none' : `1px solid ${colors.border}`,
        opacity: dimmed ? 0.7 : 1,
      }}
    >
      {field.highlight && !field.change ? (
        <div style={{ position: 'absolute', inset: '2px 6px', borderRadius: 8, background: EMPHASIS.soft, boxShadow: `inset 0 0 0 2px ${EMPHASIS.color}aa, 0 0 18px ${EMPHASIS.glow}` }} />
      ) : null}
      {lit > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: '2px 6px',
            borderRadius: 8,
            background: `rgba(124, 140, 255, ${0.14 * lit})`,
            boxShadow: `inset 0 0 0 2px ${colors.accent}${Math.round(lit * 200).toString(16).padStart(2, '0')}, 0 0 ${26 * lit}px ${colors.accentGlow}`,
          }}
        />
      ) : null}
      {tone ? (
        <div
          style={{
            position: 'absolute',
            inset: '2px 6px',
            borderRadius: 8,
            background: tone.bg,
            opacity: on,
            boxShadow: `inset 0 0 0 2px ${tone.color}${Math.round(pulse * 200).toString(16).padStart(2, '0')}, 0 0 ${24 * pulse}px ${tone.color}66`,
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px 0 12px',
          fontFamily: fonts.mono,
          opacity: slide,
          transform: `translateX(${(1 - slide) * -36}px)`,
        }}
      >
        <div style={{ width: 18, textAlign: 'center', fontSize: 22, fontWeight: 800, color: tone?.color ?? 'transparent', opacity: on, flexShrink: 0 }}>
          {tone?.marker ?? ''}
        </div>
        <div style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          {Icon ? <Icon size={19} strokeWidth={2.2} color={field.pk ? '#e8c46a' : '#8fb4ff'} /> : null}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex' }}>
          <div style={{ fontSize: 21, fontWeight: field.pk ? 650 : 500, color: nameColor, ...ellipsis }}>{field.name}</div>
          {badgesOf(field, { change: false }).map((b, i) => (
            <Badge key={i} badge={b} size={12} style={{ marginLeft: 10, alignSelf: 'center' }} />
          ))}
          {struck > 0 ? (
            <div
              style={{
                position: 'absolute',
                left: -2,
                top: '50%',
                height: 2.5,
                marginTop: -1,
                width: `calc(${struck} * (${field.name.length}ch + 4px))`,
                maxWidth: '100%',
                fontSize: 21,
                background: colors.del,
              }}
            />
          ) : null}
        </div>
        {field.type ? (
          <div style={{ fontSize: 18, color: field.change === 'removed' ? colors.faint : colors.muted, flexShrink: 0, maxWidth: '45%', ...ellipsis }}>
            {field.type}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const EntityCard: React.FC<{ placed: PlacedEntity; start: number; frame: number; fieldAt: Map<string, number>; emphasis: Emphasis; fieldLit: (index: number) => number }> = ({
  placed,
  start,
  frame,
  fieldLit,
  fieldAt,
  emphasis,
}) => {
  const { entity } = placed;
  const { fps } = useVideoConfig();
  const appear = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 110 } });
  const removed = entity.change === 'removed';
  const highlight = entity.highlight && !entity.change;
  const borderColor =
    entity.change === 'added' ? colors.add : removed ? `${colors.del}aa` : entity.change === 'modified' ? colors.accent : highlight ? EMPHASIS.color : colors.borderStrong;
  const glow =
    entity.change === 'added'
      ? `0 0 0 6px ${colors.addBg}, 0 0 44px rgba(61,220,151,0.3)`
      : entity.change === 'modified'
        ? `0 0 0 6px ${colors.accentSoft}, 0 0 48px ${colors.accentGlow}`
        : highlight
          ? emphasisRing(6, 48)
          : '0 14px 36px rgba(0,0,0,0.45)';
  const badges = badgesOf(entity);
  const iconColor = entity.change ? (entity.change === 'modified' ? colors.accent : changeTone[entity.change].color) : highlight ? EMPHASIS.color : colors.muted;
  const pillScale = spring({ frame: frame - start - 12, fps, config: { damping: 12, stiffness: 160 } });

  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x,
        top: placed.y,
        width: placed.w,
        height: placed.h,
        boxSizing: 'border-box',
        borderRadius: 18,
        background: entity.change === 'modified' ? 'linear-gradient(180deg, #1c2033, #151826)' : highlight ? EMPHASIS.card : colors.raised,
        border: `2px solid ${borderColor}`,
        borderStyle: removed ? 'dashed' : 'solid',
        boxShadow: emphasis.glow > 0 ? `${glow}, 0 0 0 ${4 * emphasis.glow}px ${colors.accent}, 0 0 ${44 * emphasis.glow}px ${colors.accentGlow}` : glow,
        opacity: appear * (removed ? 0.6 : 1) * emphasis.opacity,
        transform: `translateY(${(1 - appear) * 24}px) scale(${0.92 + 0.08 * appear})`,
      }}
    >
      <div
        style={{
          height: HEADER_H,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 18px',
          borderBottom: `1px solid ${colors.borderStrong}`,
          background: 'rgba(255,255,255,0.035)',
          borderRadius: '16px 16px 0 0',
        }}
      >
        <Table2 size={24} strokeWidth={2} color={iconColor} style={{ flexShrink: 0 }} />
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: fitFontSize(entity.name, 25, 18, 18),
            fontWeight: 700,
            color: colors.text,
            textDecoration: removed ? 'line-through' : 'none',
            textDecorationColor: colors.del,
            textDecorationThickness: 3,
            ...ellipsis,
          }}
        >
          {entity.name}
        </div>
      </div>
      {entity.fields.map((field, i) => (
        <FieldRow key={i} field={field} index={i} at={fieldAt.get(`${entity.id}/${i}`)} frame={frame} dimmed={removed} lit={fieldLit(i)} />
      ))}
      {badges.length ? <Pills badges={badges} scale={pillScale} /> : null}
    </div>
  );
};

/** Crow's-foot notation drawn just outside the card border: a bar for "one", three prongs for "many". */
function endMark(end: RelationEnd, many: boolean): string {
  const n = normal[end.side];
  const t = { x: -n.y, y: n.x };
  const at = (along: number, across: number) => `${end.point.x + n.x * along + t.x * across} ${end.point.y + n.y * along + t.y * across}`;
  if (many) return `M ${at(22, 0)} L ${at(0, -12)} M ${at(22, 0)} L ${at(0, 0)} M ${at(22, 0)} L ${at(0, 12)}`;
  return `M ${at(16, -11)} L ${at(16, 11)}`;
}

const relationColor = ({ change, highlight }: ErRelation) =>
  change === 'added' ? colors.add : change === 'removed' ? colors.del : change === 'modified' ? colors.accent : highlight ? EMPHASIS.color : EDGE;
/** A relation the diff adds or alters, or a highlighted one, glows under its line. */
const glowsSteady = (relation: ErRelation) => (relation.change ? relation.change !== 'removed' : Boolean(relation.highlight));

const RelationPath: React.FC<{ routed: RoutedRelation; index: number; draw: number; opacity: number; glow: number }> = ({ routed, index, draw, opacity, glow }) => {
  const { relation } = routed;
  const color = relationColor(relation);
  const fromMany = relation.cardinality === 'many-to-many';
  const toMany = relation.cardinality !== 'one-to-one';
  const removed = relation.change === 'removed';
  const id = `er-reveal-${index}`;
  return (
    <g opacity={draw > 0 ? (removed ? 0.8 : 1) * opacity : 0}>
      <mask id={id} maskUnits="userSpaceOnUse">
        <path d={routed.d} fill="none" stroke="#fff" strokeWidth={12} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
      </mask>
      {glowsSteady(relation) || glow > 0 ? (
        <path
          d={routed.d}
          fill="none"
          stroke={relation.change || relation.highlight ? color : colors.accent}
          strokeOpacity={(glowsSteady(relation) ? 0.22 : 0) + 0.45 * glow}
          strokeWidth={10}
          strokeLinecap="round"
          mask={`url(#${id})`}
        />
      ) : null}
      <path
        d={routed.d}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={removed ? '10 9' : undefined}
        mask={`url(#${id})`}
      />
      <path d={endMark(routed.from, fromMany)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" opacity={interpolate(draw, [0, 0.2], [0, 1], clamp)} />
      <path d={endMark(routed.to, toMany)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" opacity={interpolate(draw, [0.8, 1], [0, 1], clamp)} />
    </g>
  );
};

const RelationLabel: React.FC<{ routed: RoutedRelation; appear: number; emphasis: Emphasis }> = ({ routed, appear, emphasis }) => {
  const { relation } = routed;
  const change = relation.change;
  const color = change || relation.highlight ? relationColor(relation) : colors.muted;
  const placement: React.CSSProperties = {
    position: 'absolute',
    left: routed.mid.x,
    top: routed.mid.y,
    transform: `translate(-50%, -50%) scale(${(0.9 + 0.1 * appear) * (1 + 0.06 * emphasis.glow)})`,
    opacity: appear * emphasis.opacity,
    maxWidth: 170,
  };
  const box: React.CSSProperties = {
    padding: '4px 12px',
    borderRadius: 10,
    background: '#0d0f16',
    border: `1px solid ${emphasis.glow > 0 ? colors.accent : change || relation.highlight ? `${color}88` : colors.borderStrong}`,
    boxShadow: emphasis.glow > 0 ? `0 0 ${22 * emphasis.glow}px ${colors.accentGlow}` : relation.highlight && !change ? `0 0 18px ${EMPHASIS.glow}` : undefined,
    color,
    fontFamily: fonts.mono,
    fontSize: 17,
    textDecoration: change === 'removed' ? 'line-through' : 'none',
    ...ellipsis,
  };
  const text = `${change === 'added' ? '+ ' : ''}${relation.label}`;
  const badges = badgesOf(relation, { change: false });
  if (!badges.length) return <div style={{ ...placement, ...box }}>{text}</div>;
  // The label clips its text, so the badges sit on a wrapper of the same size.
  return (
    <div style={placement}>
      <div style={box}>{text}</div>
      <div style={{ position: 'absolute', top: -19, right: -4, display: 'flex', gap: 6 }}>
        {badges.map((b, i) => (
          <Badge key={i} badge={b} size={12} />
        ))}
      </div>
    </div>
  );
};

/** Lists only the change kinds the scene uses, so the viewer can decode the colours. */
const Legend: React.FC<{ scene: ErScene }> = ({ scene }) => {
  const used = new Set<Change>();
  for (const e of scene.entities) {
    if (e.change) used.add(e.change);
    for (const f of e.fields) if (f.change) used.add(f.change);
  }
  for (const r of scene.relations) if (r.change) used.add(r.change);
  const order: Change[] = ['added', 'removed', 'modified'];
  return (
    <div style={{ display: 'flex', gap: 22, fontSize: 19, color: colors.muted, flexShrink: 0, paddingBottom: 6 }}>
      {order
        .filter((c) => used.has(c))
        .map((c) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: changeTone[c].bg,
                border: `1px solid ${changeTone[c].color}88`,
                color: changeTone[c].color,
                fontFamily: fonts.mono,
                fontWeight: 800,
                fontSize: 19,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {changeTone[c].marker}
            </span>
            {CHANGE_WORD[c]}
          </div>
        ))}
    </div>
  );
};

export const ErDiagram: React.FC<SceneProps<ErScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const layout = useMemo(() => layoutEr(scene.entities, scene.relations), [scene.entities, scene.relations]);
  const timeline = useMemo(() => buildTimeline(layout), [layout]);
  // Each step lights what it focuses while the rest dim. A table stays bright while one of its fields or
  // relations is lit, and a relation stays as bright as its brighter end.
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const entityEmphasis = (id: string) => {
    const own = emphasisOf(`e:${id}`);
    const fields = scene.entities.find((e) => e.id === id)?.fields ?? [];
    const relations = scene.relations.flatMap((r, i) => (r.from === id || r.to === id ? [emphasisOf(`r:${i}`)] : []));
    return asBrightAs(own, [...fields.map((_, k) => emphasisOf(`f:${id}/${k}`)), ...relations]);
  };
  const relationEmphasis = (routed: RoutedRelation, i: number) =>
    brighter(emphasisOf(`r:${i}`), { ...brighter(entityEmphasis(routed.relation.from), entityEmphasis(routed.relation.to)), glow: 0, bar: 0 });
  const box = contentBox(Boolean(scene.title));
  const scale = Math.min(box.width / layout.width, box.height / layout.height, 1.3);
  const draws = layout.relations.map((_, i) => interpolate(frame, [timeline.relationAt(i), timeline.relationAt(i) + RELATION_FRAMES], [0, 1], clamp));

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.er} title={scene.title} aside={<Legend scene={scene} />}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            {layout.relations.map((routed, i) => (
              <RelationPath key={i} routed={routed} index={i} draw={draws[i]!} opacity={relationEmphasis(routed, i).opacity} glow={relationEmphasis(routed, i).glow} />
            ))}
          </svg>
          {layout.entities.map((placed, i) => (
            <EntityCard
              key={placed.entity.id}
              placed={placed}
              frame={frame}
              fieldAt={timeline.fieldAt}
              start={timeline.cardAt(i)}
              emphasis={entityEmphasis(placed.entity.id)}
              fieldLit={(k) => emphasisOf(`f:${placed.entity.id}/${k}`).glow}
            />
          ))}
          {layout.relations.map((routed, i) =>
            routed.relation.label ? (
              <RelationLabel key={i} routed={routed} emphasis={relationEmphasis(routed, i)} appear={interpolate(draws[i]!, [0.6, 1], [0, 1], clamp)} />
            ) : null,
          )}
        </div>
      </div>
    </SceneShell>
  );
};
