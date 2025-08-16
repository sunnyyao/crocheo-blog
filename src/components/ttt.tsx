import React, { useMemo, useState, useRef, useLayoutEffect } from "react";

// ====== Types ======
// These type definitions describe the data structure for our crochet pattern.
export type Vec2 = { x: number; y: number };
export type SideIndex = 0 | 1 | 2 | 3;

export interface RoundGeo {
  r: number; // Circumradius of the round's bounding square
  corners: [Vec2, Vec2, Vec2, Vec2]; // Screen coordinates for TL, TR, BR, BL corners
  center: Vec2;
}

export type StitchKind = "chain" | "dc"; // Types of stitches

export interface Cluster {
  id: string;
  side: SideIndex;
  centerPos: Vec2;
  stitches: Stitch[];
  anchorRef?: AnchorRef; // Reference to where this cluster anchors on the previous round
}

export interface AnchorRef {
  roundId: number;
  side: SideIndex;
  slotIndex: number;
}

export interface Stitch {
  id: string;
  kind: StitchKind;
  pos: Vec2; // Position of the stitch
}

export interface Side {
  side: SideIndex;
  clusters: Cluster[];
  cornerChains: [Stitch, Stitch];
  anchorsOnThisSide: Vec2[]; // Points for the *next* round to anchor to
}

export interface Round {
  id: number; // 0-based round index
  geo: RoundGeo;
  sides: [Side, Side, Side, Side];
}

// ====== Geometry Helpers ======
// Linearly interpolates between two 2D vectors.
const vecLerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Calculates the four corners of a square given its center and circumradius.
function squareFromCircumradius(center: Vec2, r: number): [Vec2, Vec2, Vec2, Vec2] {
  const halfSide = (Math.sqrt(2) * r) / 2;
  const { x, y } = center;
  return [
    { x: x - halfSide, y: y - halfSide }, // Top-Left
    { x: x + halfSide, y: y - halfSide }, // Top-Right
    { x: x + halfSide, y: y + halfSide }, // Bottom-Right
    { x: x - halfSide, y: y + halfSide }, // Bottom-Left
  ];
}

// Gets the start and end points for a given side of a square.
function sideEndpoints(corners: [Vec2, Vec2, Vec2, Vec2], side: SideIndex): [Vec2, Vec2] {
  switch (side) {
    case 0: return [corners[0], corners[1]]; // Top
    case 1: return [corners[1], corners[2]]; // Right
    case 2: return [corners[2], corners[3]]; // Bottom
    case 3: return [corners[3], corners[0]]; // Left
  }
}

// Builds the geometry object for a round.
function buildRoundGeo(roundId: number, center: Vec2, r: number): RoundGeo {
  const corners = squareFromCircumradius(center, r);
  return { r, corners, center };
}

// ====== Core Compilers ======

/**
 * Compiles a round for the "Chart View", creating a clean, schematic layout
 * with perfectly straight lines for clusters.
 */
function compileRoundForChartView(prev: Round | null, roundId: number, center: Vec2, r: number, stitchHeight: number, stitchWidth: number): Round {
    const geo = buildRoundGeo(roundId, center, r);

    if (roundId === 0) {
        const sides = [0, 1, 2, 3].map(i => {
            const side = i as SideIndex;
            return {
                side,
                clusters: [],
                cornerChains: [] as any,
                anchorsOnThisSide: [vecLerp(sideEndpoints(geo.corners, side)[0], sideEndpoints(geo.corners, side)[1], 0.5)],
            };
        }) as [Side, Side, Side, Side];
        return { id: roundId, geo, sides };
    }

    const sides = [0, 1, 2, 3].map(i => {
        const sideIndex = i as SideIndex;
        const [p0, p1] = sideEndpoints(geo.corners, sideIndex);
        const numClusters = roundId;
        const numStitchUnitsPerSide = roundId === 1 ? 4 : (numClusters * 3) + 2;
        
        const dynamicStitchWidth = stitchWidth;

        const clusters: Cluster[] = [];
        const anchorsOnThisSide: Vec2[] = [];

        const cornerT1 = 0.5 / numStitchUnitsPerSide;
        const cornerT2 = 1 - cornerT1;

        const cornerChain1Pos = vecLerp(p0, p1, cornerT1);
        const cornerChain2Pos = vecLerp(p0, p1, cornerT2);
        
        const isVerticalSide = sideIndex === 1 || sideIndex === 3;
        if (isVerticalSide) {
            cornerChain1Pos.x = p0.x;
            cornerChain2Pos.x = p0.x;
        } else {
            cornerChain1Pos.y = p0.y;
            cornerChain2Pos.y = p0.y;
        }

        const cornerChains: [Stitch, Stitch] = [
            { id: `r${roundId}-s${sideIndex}-corner1`, kind: 'chain', pos: cornerChain1Pos },
            { id: `r${roundId}-s${sideIndex}-corner2`, kind: 'chain', pos: cornerChain2Pos },
        ];
        
        anchorsOnThisSide.push(cornerChain1Pos);

        for (let j = 0; j < numClusters; j++) {
            const anchorRef: AnchorRef | undefined = prev ? {
                roundId: prev.id,
                side: sideIndex,
                slotIndex: j,
            } : undefined;

            let centerPos: Vec2;

            if (prev && anchorRef) {
                const prevAnchorPos = prev.sides[anchorRef.side].anchorsOnThisSide[anchorRef.slotIndex];
                if (isVerticalSide) {
                    centerPos = { x: prevAnchorPos.x + stitchHeight, y: prevAnchorPos.y };
                } else {
                    centerPos = { x: prevAnchorPos.x, y: prevAnchorPos.y - stitchHeight };
                }
            } else {
                let clusterCenterT = (j * 3 + 2.5) / numStitchUnitsPerSide;
                if (roundId === 1) clusterCenterT = 0.5;
                centerPos = vecLerp(p0, p1, clusterCenterT);
            }
            
            if (isVerticalSide) {
                centerPos.x = p0.x;
            } else {
                centerPos.y = p0.y;
            }

            const stitchOffset = dynamicStitchWidth * 0.8;
            const individualStitches: Stitch[] = [-1, 0, 1].map(offsetMultiplier => {
                const pos = isVerticalSide
                    ? { x: centerPos.x, y: centerPos.y + offsetMultiplier * stitchOffset }
                    : { x: centerPos.x + offsetMultiplier * stitchOffset, y: centerPos.y };
                return { id: `r${roundId}-s${sideIndex}-c${j}-dc${offsetMultiplier + 1}`, kind: 'dc', pos };
            });

            clusters.push({
                id: `r${roundId}-s${sideIndex}-c${j}`,
                side: sideIndex,
                centerPos,
                stitches: individualStitches,
                anchorRef,
            });
        }

        for (let j = 0; j < clusters.length - 1; j++) {
            const midPoint = vecLerp(clusters[j].centerPos, clusters[j+1].centerPos, 0.5);
            anchorsOnThisSide.push(midPoint);
        }
        anchorsOnThisSide.push(cornerChain2Pos);

        return { side: sideIndex, clusters, cornerChains, anchorsOnThisSide };
    }) as [Side, Side, Side, Side];

    return { id: roundId, geo, sides };
}

/**
 * Compiles a round for the "Stitch View", creating a realistic layout
 * where stitches follow the natural geometry of the square.
 */
function compileRoundForStitchView(prev: Round | null, roundId: number, center: Vec2, r: number, stitchHeight: number, stitchWidth: number): Round {
    const geo = buildRoundGeo(roundId, center, r);

    if (roundId === 0) {
        const sides = [0, 1, 2, 3].map(i => {
            const side = i as SideIndex;
            return {
                side,
                clusters: [],
                cornerChains: [] as any,
                anchorsOnThisSide: [vecLerp(sideEndpoints(geo.corners, side)[0], sideEndpoints(geo.corners, side)[1], 0.5)],
            };
        }) as [Side, Side, Side, Side];
        return { id: roundId, geo, sides };
    }

    const sides = [0, 1, 2, 3].map(i => {
        const sideIndex = i as SideIndex;
        const [p0, p1] = sideEndpoints(geo.corners, sideIndex);
        const sideLength = Math.hypot(p1.x - p0.x, p1.y - p0.y);
        const numClusters = roundId;
        const numStitchUnitsPerSide = roundId === 1 ? 4 : (numClusters * 3) + 2;
        const dynamicStitchWidth = sideLength / numStitchUnitsPerSide;

        const clusters: Cluster[] = [];
        const anchorsOnThisSide: Vec2[] = [];

        const cornerT1 = 0.5 / numStitchUnitsPerSide;
        const cornerT2 = 1 - cornerT1;

        const cornerChain1Pos = vecLerp(p0, p1, cornerT1);
        const cornerChain2Pos = vecLerp(p0, p1, cornerT2);
        
        const cornerChains: [Stitch, Stitch] = [
            { id: `r${roundId}-s${sideIndex}-corner1`, kind: 'chain', pos: cornerChain1Pos },
            { id: `r${roundId}-s${sideIndex}-corner2`, kind: 'chain', pos: cornerChain2Pos },
        ];
        
        anchorsOnThisSide.push(cornerChain1Pos);

        for (let j = 0; j < numClusters; j++) {
            let clusterCenterT = (j * 3 + 2.5) / numStitchUnitsPerSide;
            if (roundId === 1) clusterCenterT = 0.5;

            const centerPos = vecLerp(p0, p1, clusterCenterT);

            const anchorRef: AnchorRef | undefined = prev ? {
                roundId: prev.id,
                side: sideIndex,
                slotIndex: j,
            } : undefined;

            const isVerticalSide = sideIndex === 1 || sideIndex === 3;
            const stitchOffset = dynamicStitchWidth * 0.8;
            const individualStitches: Stitch[] = [-1, 0, 1].map(offsetMultiplier => {
                const pos = isVerticalSide
                    ? { x: centerPos.x, y: centerPos.y + offsetMultiplier * stitchOffset }
                    : { x: centerPos.x + offsetMultiplier * stitchOffset, y: centerPos.y };
                return { id: `r${roundId}-s${sideIndex}-c${j}-dc${offsetMultiplier + 1}`, kind: 'dc', pos };
            });

            clusters.push({
                id: `r${roundId}-s${sideIndex}-c${j}`,
                side: sideIndex,
                centerPos,
                stitches: individualStitches,
                anchorRef,
            });
        }

        for (let j = 0; j < clusters.length - 1; j++) {
            const midPoint = vecLerp(clusters[j].centerPos, clusters[j+1].centerPos, 0.5);
            anchorsOnThisSide.push(midPoint);
        }
        anchorsOnThisSide.push(cornerChain2Pos);

        return { side: sideIndex, clusters, cornerChains, anchorsOnThisSide };
    }) as [Side, Side, Side, Side];

    return { id: roundId, geo, sides };
}


// Builds all rounds based on a list of radii, choosing the correct compile function.
export function buildRounds(radii: number[], center: Vec2, stitchHeight: number, stitchWidth: number, isChartView: boolean): Round[] {
  const rounds: Round[] = [];

  for (let i = 0; i < radii.length; i++) {
    const prevRound = i === 0 ? null : rounds[i - 1];
    let round;

    if (isChartView) {
        round = compileRoundForChartView(prevRound, i, center, radii[i], stitchHeight, stitchWidth);
    } else {
        round = compileRoundForStitchView(prevRound, i, center, radii[i], stitchHeight, stitchWidth);
    }
    rounds.push(round);
  }
  return rounds;
}


// ====== Canvas Renderer Component ======
interface GrannySquareCanvasProps {
    width: number;
    height: number;
    rounds: Round[];
    stitchHeight: number;
    stitchWidth: number;
    isChartView: boolean;
    showStitches: boolean;
}

// This component handles all the drawing logic on the HTML canvas.
function drawEllipse(ctx: CanvasRenderingContext2D, stitch: Stitch, rx: number, ry: number, color: string, isVertical: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.translate(stitch.pos.x, stitch.pos.y);
  if (isVertical) {
    ctx.rotate(Math.PI / 2);
  }
  ctx.ellipse(0, 0, rx, ry, 0, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

interface DrawRoundProps {
    round: Round;
    rounds: Round[];
    color: string;
    stitchHeight: number;
    stitchWidth: number;
    isChartView: boolean;
    showStitches: boolean;
}

function drawRound(ctx: CanvasRenderingContext2D, { round, rounds, color, stitchHeight, stitchWidth, isChartView, showStitches }: DrawRoundProps) {
  const { corners } = round.geo;

  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  ctx.globalAlpha = 0.5;
  ctx.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  if (round.id === 0 && (showStitches || isChartView)) {
    const r0ellipseRx = stitchWidth / 2;
    const r0ellipseRy = stitchHeight / 4;
    const stitchPositions = corners.map((p1, i) => vecLerp(p1, corners[(i + 1) % 4], 0.5));

    ctx.beginPath();
    ctx.moveTo(stitchPositions[0].x, stitchPositions[0].y);
    stitchPositions.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    
    stitchPositions.forEach((centerPos, i) => {
      const isVertical = i === 1 || i === 3;
      drawEllipse(ctx, { pos: centerPos } as Stitch, r0ellipseRx, r0ellipseRy, color, isVertical);
    });
  }

  if (round.id >= 1) {
    const sideLength = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const numStitchUnitsPerSide = round.id === 1 ? 4 : (round.id * 3) + 2;
    const dynamicStitchWidth = isChartView ? stitchWidth : sideLength / numStitchUnitsPerSide;
    const ellipseRx = dynamicStitchWidth / 2;
    const ellipseRy = stitchHeight / 4;
    const chartEllipseRx = stitchWidth / 4;
    const chartEllipseRy = stitchHeight / 8;

    round.sides.forEach(side => {
      const isVertical = side.side === 1 || side.side === 3;
      
      if (isChartView || showStitches) {
        const rx = isChartView ? chartEllipseRx : ellipseRx;
        const ry = isChartView ? chartEllipseRy : ellipseRy;
        side.cornerChains.forEach(stitch => drawEllipse(ctx, stitch, rx, ry, color, isVertical));
      }

      side.clusters.forEach(cluster => {
        if (isChartView && cluster.anchorRef) {
          const prevRound = rounds[cluster.anchorRef.roundId];
          const prevSide = prevRound?.sides[cluster.anchorRef.side];
          const anchorPos = prevSide?.anchorsOnThisSide[cluster.anchorRef.slotIndex];
          
          if (anchorPos) {
              cluster.stitches.forEach(stitch => {
                ctx.save();
                ctx.strokeStyle = "rgba(180, 180, 180, 1)";
                ctx.lineWidth = 1;

                ctx.beginPath();
                ctx.moveTo(anchorPos.x, anchorPos.y);
                ctx.lineTo(stitch.pos.x, stitch.pos.y);
                ctx.stroke();

                const dx = stitch.pos.x - anchorPos.x;
                const dy = stitch.pos.y - anchorPos.y;
                const dist = Math.hypot(dx, dy);
                const unitVec = { x: dx / dist, y: dy / dist };
                const perpVec = { x: -unitVec.y, y: unitVec.x };
                const crossbarPoint = { x: stitch.pos.x - unitVec.x * dist * 0.25, y: stitch.pos.y - unitVec.y * dist * 0.25 };
                const crossbarHalfWidth = stitchWidth / 3;
                
                ctx.beginPath();
                ctx.moveTo(crossbarPoint.x - perpVec.x * crossbarHalfWidth, crossbarPoint.y - perpVec.y * crossbarHalfWidth);
                ctx.lineTo(crossbarPoint.x + perpVec.x * crossbarHalfWidth, crossbarPoint.y + perpVec.y * crossbarHalfWidth);
                ctx.stroke();
                ctx.restore();
              });
          }
        }
        
        if (showStitches) {
            const rx = isChartView ? chartEllipseRx : ellipseRx;
            const ry = isChartView ? chartEllipseRy : ellipseRy;
            cluster.stitches.forEach(stitch => drawEllipse(ctx, stitch, rx, ry, color, isVertical));
        }
      });
    });
  }
}

const GrannySquareCanvas: React.FC<GrannySquareCanvasProps> = ({ width, height, rounds, ...props }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !rounds || rounds.length === 0) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(width / 2, height / 2);

    rounds.forEach((round) => {
      drawRound(ctx, {
        round,
        rounds,
        color: `hsl(${(round.id * 55 + 180) % 360} 70% 40%)`,
        ...props
      });
    });
    
    ctx.restore();
  }, [width, height, rounds, props]);

  return <canvas ref={canvasRef} />;
}


// ====== Main App Component ======
const App: React.FC = () => {
  const [nRounds, setNRounds] = useState(4);
  const [stitchWidth, setStitchWidth] = useState(12);
  const [stitchHeight, setStitchHeight] = useState(12);
  const [isChartView, setIsChartView] = useState(true);
  const [showStitches, setShowStitches] = useState(true);

  const radii = useMemo(() => {
    const r: number[] = [];
    if (nRounds > 0) {
      const r0 = stitchWidth / Math.sqrt(2);
      r.push(r0);
      for (let i = 1; i < nRounds; i++) {
        r.push(r[i - 1] + 2 * stitchHeight);
      }
    }
    return r;
  }, [nRounds, stitchWidth, stitchHeight]);

  const rounds = useMemo(() => 
    buildRounds(radii, { x: 0, y: 0 }, stitchHeight, stitchWidth, isChartView), 
    [radii, stitchHeight, stitchWidth, isChartView]
  );

  return (
    <div className="bg-gray-100 min-h-screen flex items-center justify-center font-sans">
      <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-2xl shadow-lg">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Classic Granny Square – Canvas Renderer</h1>
          <p className="text-md text-gray-600">A generative model with separate logic for Chart and Stitch views.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 p-4 bg-gray-50 rounded-lg border">
          <label className="flex flex-col items-start gap-2 text-sm font-medium text-gray-700">
            <span>Stitch Width</span>
            <input type="range" min="4" max="30" className="w-full" value={stitchWidth} onChange={(e) => setStitchWidth(Number(e.target.value))} />
            <span className="text-xs text-gray-500 self-center">{stitchWidth}px</span>
          </label>
          <label className="flex flex-col items-start gap-2 text-sm font-medium text-gray-700">
            <span>Stitch Height</span>
            <input type="range" min="4" max="30" className="w-full" value={stitchHeight} onChange={(e) => setStitchHeight(Number(e.target.value))} />
            <span className="text-xs text-gray-500 self-center">{stitchHeight}px</span>
          </label>
          <label className="flex flex-col items-start gap-2 text-sm font-medium text-gray-700">
            <span>Rounds</span>
            <input type="range" min="1" max="10" className="w-full" value={nRounds} onChange={(e) => setNRounds(Math.max(1, Number(e.target.value) || 1))} />
            <span className="text-xs text-gray-500 self-center">{nRounds}</span>
          </label>
          <label className="flex flex-col items-center justify-center gap-2 text-sm font-medium text-gray-700">
            <span>Chart View</span>
            <div className="flex items-center">
              <input type="checkbox" checked={isChartView} onChange={() => setIsChartView(!isChartView)} className="h-5 w-5 rounded" />
            </div>
          </label>
          <label className="flex flex-col items-center justify-center gap-2 text-sm font-medium text-gray-700">
            <span>Show Stitches</span>
            <div className="flex items-center">
              <input type="checkbox" checked={showStitches} onChange={() => setShowStitches(!showStitches)} className="h-5 w-5 rounded" />
            </div>
          </label>
        </div>

        <div className="bg-gray-50 rounded-xl shadow-inner p-2 border flex justify-center items-center">
          <GrannySquareCanvas
            width={520}
            height={520}
            rounds={rounds}
            stitchHeight={stitchHeight}
            stitchWidth={stitchWidth}
            isChartView={isChartView}
            showStitches={showStitches}
          />
        </div>
        <details className="mt-6 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium text-gray-800 hover:text-blue-600">View Model Notes</summary>
          <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Separated Logic:</strong> The model now uses two distinct functions, <code>compileRoundForChartView</code> and <code>compileRoundForStitchView</code>, to generate the pattern data.</li>
              <li><strong>Chart View:</strong> Creates a clean, schematic diagram with perfectly aligned stitches.</li>
              <li><strong>Stitch View:</strong> (Uncheck "Chart View") Creates a more realistic-looking pattern that follows the natural geometry.</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}

export default App;
