"use client";

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GraphEdge, GraphNode } from "@/lib/queries/paths";

import { cx } from "./ui/primitives";

/**
 * A force-directed view of one package's neighbourhood.
 *
 * The layout carries meaning rather than being decoration: the focus package is
 * pinned at the centre, everything that depends on it settles to the left, and
 * everything it pulls in settles to the right. So the picture reads the way the
 * sentence does — "these things need it, it needs those" — and a package with a
 * wide left-hand fan is visibly load-bearing before you read a single label.
 *
 * The simulation is run in a ref rather than in React state. Sixty position
 * updates a second through `setState` would re-render the whole tree on every
 * tick; here the DOM nodes are moved directly and React only re-renders when
 * something the user did changes.
 */

type SimNode = SimulationNodeDatum & GraphNode;
type SimLink = SimulationLinkDatum<SimNode> & { type: string };

const WIDTH = 900;
const HEIGHT = 520;

const SEVERITY_FILL: Record<string, string> = {
  critical: "var(--color-critical)",
  high: "var(--color-high)",
  moderate: "var(--color-moderate)",
  low: "var(--color-low)",
};

export function GraphCanvas({
  nodes: inputNodes,
  edges: inputEdges,
  focusId,
  truncated,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  focusId: string;
  truncated: boolean;
}) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const groupRef = useRef<SVGGElement | null>(null);
  const simulationRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodeElements = useRef(new Map<string, SVGGElement>());
  const linkElements = useRef(new Map<string, SVGLineElement>());

  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const dragState = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(null);

  // Rebuilt only when the data actually changes; d3 mutates these objects in
  // place as it runs, so they must not be recreated on every render.
  const { simNodes, simLinks } = useMemo(() => {
    const byId = new Map<string, SimNode>();
    for (const node of inputNodes) {
      byId.set(node.id, {
        ...node,
        // Seed each node on the side it belongs on so the layout converges to
        // the intended shape instead of finding a mirror image of it.
        x: WIDTH / 2 + node.depth * 150 + (Math.random() - 0.5) * 40,
        y: HEIGHT / 2 + (Math.random() - 0.5) * 260,
      });
    }
    const links: SimLink[] = [];
    for (const edge of inputEdges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source && target) links.push({ source, target, type: edge.type });
    }
    return { simNodes: [...byId.values()], simLinks: links };
  }, [inputNodes, inputEdges]);

  useEffect(() => {
    const focus = simNodes.find((node) => node.id === focusId);
    if (focus) {
      focus.fx = WIDTH / 2;
      focus.fy = HEIGHT / 2;
    }

    const simulation = forceSimulation<SimNode, SimLink>(simNodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).id((node) => node.id).distance(70).strength(0.35))
      .force("charge", forceManyBody<SimNode>().strength(-240).distanceMax(420))
      .force("collide", forceCollide<SimNode>().radius((node) => radiusFor(node) + 6))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2).strength(0.05))
      // Depth drives the horizontal axis: dependents left, dependencies right.
      .force("x", forceX<SimNode>((node) => WIDTH / 2 + node.depth * 190).strength(0.4))
      .force("y", forceY<SimNode>(HEIGHT / 2).strength(0.06))
      .alphaDecay(0.035);

    simulationRef.current = simulation;

    simulation.on("tick", () => {
      for (const node of simNodes) {
        const element = nodeElements.current.get(node.id);
        if (element) element.setAttribute("transform", `translate(${node.x ?? 0} ${node.y ?? 0})`);
      }
      for (const [index, link] of simLinks.entries()) {
        const element = linkElements.current.get(String(index));
        if (!element) continue;
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        element.setAttribute("x1", String(source.x ?? 0));
        element.setAttribute("y1", String(source.y ?? 0));
        element.setAttribute("x2", String(target.x ?? 0));
        element.setAttribute("y2", String(target.y ?? 0));
      }
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [simNodes, simLinks, focusId]);

  // ------------------------------------------------------------ pan & zoom --

  const onWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setView((current) => {
      const nextScale = Math.min(2.5, Math.max(0.4, current.scale * (event.deltaY > 0 ? 0.92 : 1.08)));
      return { ...current, scale: nextScale };
    });
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0) return;
      (event.target as Element).setPointerCapture?.(event.pointerId);
      dragState.current = { pointerX: event.clientX, pointerY: event.clientY, originX: view.x, originY: view.y };
    },
    [view.x, view.y],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    setView((current) => ({
      ...current,
      x: drag.originX + (event.clientX - drag.pointerX),
      y: drag.originY + (event.clientY - drag.pointerY),
    }));
  }, []);

  const endDrag = useCallback(() => {
    dragState.current = null;
  }, []);

  const reset = useCallback(() => {
    setView({ x: 0, y: 0, scale: 1 });
    simulationRef.current?.alpha(0.6).restart();
  }, []);

  // Pan, then zoom about the centre of the canvas rather than its top-left
  // corner, so scrolling to zoom keeps whatever is in the middle of the view in
  // the middle of the view.
  const viewTransform =
    `translate(${view.x} ${view.y}) ` +
    `translate(${WIDTH / 2} ${HEIGHT / 2}) scale(${view.scale}) translate(${-WIDTH / 2} ${-HEIGHT / 2})`;

  if (inputNodes.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center px-6 text-center">
        <p className="max-w-sm text-[13px] text-ink-muted">
          Nothing to draw — this package has no recorded dependencies or dependents.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[520px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label={`Dependency neighbourhood of ${focusId}: ${inputNodes.length} packages, ${inputEdges.length} relationships`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="var(--color-line-strong)" />
          </marker>
        </defs>

        <g
          ref={groupRef}
          transform={viewTransform}
        >
          <g>
            {simLinks.map((link, index) => (
              <line
                key={index}
                ref={(element) => {
                  if (element) linkElements.current.set(String(index), element);
                  else linkElements.current.delete(String(index));
                }}
                stroke="var(--color-line-strong)"
                strokeWidth={1}
                strokeDasharray={link.type === "DEPENDS_ON" ? undefined : "3 3"}
                markerEnd="url(#arrow)"
                opacity={0.7}
              />
            ))}
          </g>

          <g>
            {simNodes.map((node) => {
              const radius = radiusFor(node);
              const isFocus = node.id === focusId;
              return (
                <g
                  key={node.id}
                  ref={(element) => {
                    if (element) nodeElements.current.set(node.id, element);
                    else nodeElements.current.delete(node.id);
                  }}
                  className="cursor-pointer"
                  onMouseEnter={() => setHovered(node)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() =>
                    router.push(
                      node.kind === "application"
                        ? `/applications/${encodeURIComponent(node.id)}`
                        : `/packages/${encodeURIComponent(node.id)}`,
                    )
                  }
                >
                  <circle
                    r={radius}
                    fill={
                      isFocus
                        ? "var(--color-accent)"
                        : node.kind === "application"
                          ? "var(--color-accent-dim)"
                          : node.severity
                            ? SEVERITY_FILL[node.severity]
                            : "var(--color-surface-raised)"
                    }
                    stroke={isFocus ? "var(--color-accent)" : "var(--color-line-strong)"}
                    strokeWidth={isFocus ? 3 : 1}
                    opacity={node.severity || isFocus || node.kind === "application" ? 1 : 0.9}
                  />
                  {radius >= 7 || isFocus ? (
                    <text
                      y={radius + 11}
                      textAnchor="middle"
                      className="pointer-events-none"
                      fontSize={isFocus ? 12 : 9.5}
                      fontWeight={isFocus ? 600 : 400}
                      fill={isFocus ? "var(--color-ink)" : "var(--color-ink-faint)"}
                    >
                      {truncateLabel(node.label, isFocus ? 26 : 16)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Controls */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <ControlButton label="Zoom in" onClick={() => setView((v) => ({ ...v, scale: Math.min(2.5, v.scale * 1.2) }))}>
          +
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.4, v.scale / 1.2) }))}>
          −
        </ControlButton>
        <ControlButton label="Reset layout" onClick={reset}>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 9a8 8 0 0 1 13.6-4M20 5v4h-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 15a8 8 0 0 1-13.6 4M4 19v-4h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ControlButton>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-ink-faint backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent" /> focus
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-critical" /> has advisory
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-dim" /> application
        </span>
        <span>← depends on it · it depends on →</span>
        {truncated ? <span className="text-moderate">· trimmed to 140 nodes</span> : null}
      </div>

      {hovered ? (
        <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-line bg-surface px-3 py-2 shadow-lg">
          <p className="font-mono text-[12px] font-medium text-ink">{hovered.label}</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {hovered.kind === "application"
              ? "Application"
              : `${hovered.depth < 0 ? "Depends on this package" : hovered.depth === 0 ? "This package" : `${hovered.depth} hop${hovered.depth > 1 ? "s" : ""} away`}`}
            {hovered.advisories > 0 ? ` · ${hovered.advisories} advisory` : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ControlButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cx(
        "flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-[13px] text-ink-muted",
        "transition-colors hover:border-line-strong hover:text-ink",
      )}
    >
      <span className="sr-only">{label}</span>
      {children}
    </button>
  );
}

/** Node size follows how many things depend on it, on a log scale so hubs don't swamp the canvas. */
function radiusFor(node: GraphNode): number {
  if (node.kind === "application") return 9;
  const base = 4 + Math.log10(1 + node.weeklyDownloads / 1000) * 2.2;
  return Math.min(15, Math.max(4, base));
}

function truncateLabel(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}
