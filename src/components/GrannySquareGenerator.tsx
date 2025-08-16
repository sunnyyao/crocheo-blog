import React, { useMemo, useState, useRef, useLayoutEffect, forwardRef } from "react";

// ====== Types ======
// These type definitions describe the data structure for our crochet pattern.
export type Vec2 = { x: number; y: number };
export type SideIndex = 0 | 1 | 2 | 3;
export type AnchorType = 'corner' | 'side-space' | 'center-ring';

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
  type: AnchorType; // The type of space this cluster is worked into.
}

export interface Stitch {
  id: string;
  kind: StitchKind;
  pos: Vec2; // Position of the stitch
}

// An Anchor represents a point on a round where the *next* round can attach.
export interface Anchor {
    pos: Vec2;
    type: AnchorType;
}

export interface Side {
  side: SideIndex;
  clusters: Cluster[];
  cornerChains: [Stitch, Stitch];
  anchorsOnThisSide: Anchor[]; // Points for the *next* round to anchor to
}

export interface Round {
  id: number; // 0-based round index
  geo: RoundGeo;
  sides: [Side, Side, Side, Side];
}

// ====== Color Palettes ======
const colorPalettes = [
    { name: "Sunset Glow", colors: ["#8b0000", "#ff6b35", "#f7931e", "#ffdc00", "#fff8dc"] },
    { name: "Ocean Blues", colors: ["#003366", "#0066cc", "#3399ff", "#66ccff", "#e6f7ff"] },
    { name: "Forest Greens", colors: ["#1a4d3a", "#2d7d32", "#66bb6a", "#a5d6a7", "#e8f5e8"] },
    { name: "Classic Vintage", colors: ["#8b4513", "#daa520", "#cd853f", "#f5deb3", "#fff8dc"] },
    { name: "Purple Dreams", colors: ["#4a148c", "#7b1fa2", "#ab47bc", "#ce93d8", "#f3e5f5"] },
    { name: "Default", colors: [] } // For the original generative colors
];


// ====== Geometry Helpers ======
const vecLerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

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

function sideEndpoints(corners: [Vec2, Vec2, Vec2, Vec2], side: SideIndex): [Vec2, Vec2] {
  switch (side) {
    case 0: return [corners[0], corners[1]]; // Top
    case 1: return [corners[1], corners[2]]; // Right
    case 2: return [corners[2], corners[3]]; // Bottom
    case 3: return [corners[3], corners[0]]; // Left
  }
}

function buildRoundGeo(roundId: number, center: Vec2, r: number): RoundGeo {
  const corners = squareFromCircumradius(center, r);
  return { r, corners, center };
}

// ====== Core Compiler ======
function compileRoundForChartView(prev: Round | null, roundId: number, center: Vec2, r: number, stitchHeight: number, stitchWidth: number): Round {
    const geo = buildRoundGeo(roundId, center, r);

    if (roundId === 0) {
        const sides = [0, 1, 2, 3].map(i => {
          const side = i as SideIndex;
          return {
            side,
            clusters: [],
            cornerChains: [] as any,
            anchorsOnThisSide: [{
                pos: vecLerp(sideEndpoints(geo.corners, side)[0], sideEndpoints(geo.corners, side)[1], 0.5),
                type: 'center-ring'
            }],
          };
        }) as unknown as [Side, Side, Side, Side];
        return { id: roundId, geo, sides };
    }

    const sides = [0, 1, 2, 3].map(i => {
        const sideIndex = i as SideIndex;
        const [p0, p1] = sideEndpoints(geo.corners, sideIndex);
        const numClusters = roundId;
        const numStitchUnitsPerSide = roundId === 1 ? 4 : (numClusters * 3) + 2;
        const clusters: Cluster[] = [];
        const anchorsOnThisSide: Anchor[] = [];

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
        
        anchorsOnThisSide.push({ pos: cornerChain1Pos, type: 'corner' });

        for (let j = 0; j < numClusters; j++) {
            const anchorType = prev?.sides[sideIndex].anchorsOnThisSide[j].type;
            const anchorRef: AnchorRef | undefined = prev ? {
                roundId: prev.id,
                side: sideIndex,
                slotIndex: j,
                type: anchorType || 'side-space', // Default to side-space
            } : undefined;

            let centerPos: Vec2;

            if (prev && anchorRef) {
                const prevAnchorPos = prev.sides[anchorRef.side].anchorsOnThisSide[anchorRef.slotIndex].pos;
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
            
            if (isVerticalSide) { centerPos.x = p0.x; } else { centerPos.y = p0.y; }

            const stitchOffset = stitchWidth * 0.8;
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
            anchorsOnThisSide.push({ pos: midPoint, type: 'side-space' });
        }
        anchorsOnThisSide.push({ pos: cornerChain2Pos, type: 'corner' });

        return { side: sideIndex, clusters, cornerChains, anchorsOnThisSide };
    }) as [Side, Side, Side, Side];

    return { id: roundId, geo, sides };
}


// Builds all rounds based on a list of radii.
export function buildRounds(radii: number[], center: Vec2, stitchHeight: number, stitchWidth: number): Round[] {
  const rounds: Round[] = [];
  for (let i = 0; i < radii.length; i++) {
    const prevRound = i === 0 ? null : rounds[i - 1];
    const round = compileRoundForChartView(prevRound, i, center, radii[i], stitchHeight, stitchWidth);
    rounds.push(round);
  }
  return rounds;
}

// ====== Written Pattern Generator ======

// === Helper Functions ===
function cornerInstruction(roundNum: number, first: boolean = false): string {
  if (first) {
    return `Chain 3 (counts as a dc), then work 2 dc, chain 2, and 3 dc all into the same corner space. (This makes the first corner.)`;
  }
  return `In the next corner space, work 3 dc, chain 2, 3 dc. (This makes a corner.)`;
}

function sideInstruction(sideClusters: number): string {
  if (sideClusters === 0) return "";
  if (sideClusters === 1) {
    return `Chain 1. In the next chain-1 space along the side, work 3 dc.`;
  }
  return `Along each side: *Chain 1, work 3 dc in the next chain-1 space.* Repeat until you reach the next corner.`;
}

function roundSummary(roundNum: number): string {
  if (roundNum === 1) return "You now have 4 groups of 3 dc and 4 corner chain-2 spaces.";
  if (roundNum === 2) return "You now have 8 groups of 3 dc and 4 corner chain-2 spaces.";
  if (roundNum === 3) return "You now have 12 groups of 3 dc and 4 corner chain-2 spaces.";
  return "Each new round adds one more group of 3 dc along each side, while the corners stay the same.";
}

// === Main Pattern Generator ===
function generateWrittenPattern(rounds: { id: number }[]): string {
  if (!rounds || rounds.length === 0) return "No pattern to display.";

  const instructions: string[] = [];
  instructions.push("Start: Chain 4. Join with a slip stitch to the first chain to form a ring.");

  rounds.forEach(round => {
    const n = round.id + 1;
   
    let roundText = `\nRound ${n}:\n`;

    if (n === 1) {
      roundText +=
        "1. Chain 3 (counts as dc), work 2 dc into the ring, then chain 2.\n" +
        "2. *Work 3 dc into the ring, chain 2.* Repeat 2 more times.\n" +
        "3. Join with a slip stitch to the top of the beginning chain-3.\n" +
        "👉 " + roundSummary(n);
    } else {
      roundText +=
        `1. Slip stitch across to the next corner chain-2 space.\n` +
        `2. ${cornerInstruction(n, true)}\n`;

      if (n >= 3) {
        roundText += `3. ${sideInstruction(round.id - 1)}\n`;
        roundText += `4. ${cornerInstruction(n)}\n`;
        roundText += "5. Repeat sides and corners around until you return to the beginning.\n";
      } else {
        // round 2 only has corners, no side spaces yet
        roundText += `3. ${cornerInstruction(n)}\n`;
        roundText += "4. Work the same corner group into each remaining corner space.\n";
      }

      roundText += `6. Join with a slip stitch to the top of the beginning chain-3.\n` +
                   "👉 " + roundSummary(n);
    }

    instructions.push(roundText);
  });

  return instructions.join("\n\n");
}
/*
function generateWrittenPattern(rounds: Round[]): string {
    if (!rounds || rounds.length === 0) return "No pattern to display.";
    const instructions: string[] = [];
    instructions.push("Start: Create a magic ring.");
    rounds.forEach(round => {
        if (round.id === 0) return; // Skip foundation round data
        const n = round.id; // The round number is the same as the data ID
        let roundText = `\nRound ${n}:\n`;
        if (n === 1) {
            roundText += "1. Chain 3 (counts as first dc), work 2 dc into the ring, then chain 2.\n" +
                         "2. *Work 3 dc into the ring, chain 2.* Repeat from * to * 2 more times.\n" +
                         "3. Join with a slip stitch to the top of the beginning chain-3.";
        } else {
            const sideClusters = round.id - 1;
            roundText += "1. Slip stitch into the next corner ch-2 space.\n" +
                         "2. Ch 3 (counts as first dc), work (2 dc, ch 2, 3 dc) all in the same corner space.\n" +
                         `3. *Ch 1, 3 dc in next ch-1 space.* Repeat from * to * ${sideClusters - 1} more time(s) along the side.\n` +
                         "4. Ch 1, work (3 dc, ch 2, 3 dc) in the next corner space.\n" +
                         "5. Repeat steps 3 and 4 for the remaining sides.\n" +
                         "6. Join with a slip stitch to the top of the beginning chain-3.";
        }
        instructions.push(roundText);
    });
    return instructions.join("\n\n");
}
*/

// ====== Canvas Renderer Component ======
function drawEllipse(ctx: CanvasRenderingContext2D, stitch: Stitch, rx: number, ry: number, color: string, isVertical: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.translate(stitch.pos.x, stitch.pos.y);
  if (isVertical) {
    ctx.rotate(Math.PI / 2);
  }
  ctx.ellipse(0, 0, rx, ry, 0, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawRound(ctx: CanvasRenderingContext2D, { round, rounds, color, stitchHeight, stitchWidth, showStitches }: { round: Round; rounds: Round[]; color: string; stitchHeight: number; stitchWidth: number; showStitches: boolean; }) {
  const { corners } = round.geo;

  ctx.save();
  ctx.beginPath();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((p: Vec2) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  if (round.id === 0 ) {
    const r0ellipseRx = stitchWidth / 4;
    const r0ellipseRy = stitchHeight / 8;
    const stitchPositions = corners.map((p1: Vec2, i: number) => vecLerp(p1, corners[(i + 1) % 4], 0.5));
    ctx.beginPath();
    ctx.moveTo(stitchPositions[0].x, stitchPositions[0].y);
    stitchPositions.slice(1).forEach((p: { x: number; y: number; }) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    stitchPositions.forEach((centerPos: any, i: number) => {
      const isVertical = i === 1 || i === 3;
      drawEllipse(ctx, { pos: centerPos } as Stitch, r0ellipseRx, r0ellipseRy, color, isVertical);
    });
  }

  if (round.id >= 1) {
    const chartEllipseRx = stitchWidth / 4;
    const chartEllipseRy = stitchHeight / 8;

    round.sides.forEach(side => {
      const isVertical = side.side === 1 || side.side === 3;
      
      side.cornerChains.forEach(stitch => drawEllipse(ctx, stitch, chartEllipseRx, chartEllipseRy, color, isVertical));
      
      side.clusters.forEach(cluster => {
        if (cluster.anchorRef) {
          const prevRound = rounds[cluster.anchorRef.roundId];
          const prevSide = prevRound?.sides[cluster.anchorRef.side];
          const anchor = prevSide?.anchorsOnThisSide[cluster.anchorRef.slotIndex];
          
          if (anchor) {
            const anchorPos = anchor.pos;
            const isTheOneTrueStartOfRound = side.side === 1 && (anchor.type === 'corner' || anchor.type === 'center-ring') && cluster.id.endsWith('-c0');

            if (isTheOneTrueStartOfRound) {
                const leftStitch = cluster.stitches[0];
                const dx = leftStitch.pos.x - anchorPos.x;
                const dy = leftStitch.pos.y - anchorPos.y;
                const angle = Math.atan2(dy, dx);
                const dist = Math.hypot(dx, dy);

                ctx.save();
                ctx.translate(anchorPos.x, anchorPos.y);
                ctx.rotate(angle);
                const p1_dist = dist * 0.25;
                const p2_dist = dist * 0.5;
                const p3_dist = dist * 0.75;
                drawEllipse(ctx, { pos: { x: p1_dist, y: 0 } } as Stitch, chartEllipseRx * 0.8, chartEllipseRy * 0.8, color, false);
                drawEllipse(ctx, { pos: { x: p2_dist, y: 0 } } as Stitch, chartEllipseRx * 0.8, chartEllipseRy * 0.8, color, false);
                drawEllipse(ctx, { pos: { x: p3_dist, y: 0 } } as Stitch, chartEllipseRx * 0.8, chartEllipseRy * 0.8, color, false);
                ctx.restore();

                cluster.stitches.slice(1).forEach(stitch => {
                    ctx.save();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(anchorPos.x, anchorPos.y);
                    ctx.lineTo(stitch.pos.x, stitch.pos.y);
                    ctx.stroke();
                    
                    const dxStitch = stitch.pos.x - anchorPos.x;
                    const dyStitch = stitch.pos.y - anchorPos.y;
                    const distStitch = Math.hypot(dxStitch, dyStitch);
                    const unitVec = { x: dxStitch / distStitch, y: dyStitch / distStitch };
                    const perpVec = { x: -unitVec.y, y: unitVec.x };
                    const crossbarPoint = { x: stitch.pos.x - unitVec.x * distStitch * 0.25, y: stitch.pos.y - unitVec.y * distStitch * 0.25 };
                    const crossbarHalfWidth = stitchWidth / 3;
                    ctx.beginPath();
                    ctx.moveTo(crossbarPoint.x - perpVec.x * crossbarHalfWidth, crossbarPoint.y - perpVec.y * crossbarHalfWidth);
                    ctx.lineTo(crossbarPoint.x + perpVec.x * crossbarHalfWidth, crossbarPoint.y + perpVec.y * crossbarHalfWidth);
                    ctx.stroke();
                    ctx.restore();
                });
            } else {
                cluster.stitches.forEach(stitch => {
                    ctx.save();
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(anchorPos.x, anchorPos.y);
                    ctx.lineTo(stitch.pos.x, stitch.pos.y);
                    ctx.stroke();
                    
                    const dx = stitch.pos.x - anchorPos.x;
                    const dy = stitch.pos.y - anchorPos.y;
                    const dist = Math.hypot(dx, dy);
                    const unitVec = { x: dx / dist, y: dy / dist };
                    const perpVec = { x: -unitVec.y, y: unitVec.x };
                    const crossbarPoint = { x: stitch.pos.x - unitVec.x * dist * 0.3, y: stitch.pos.y - unitVec.y * dist * 0.3 };
                    const crossbarHalfWidth = stitchWidth / 5;
                    ctx.beginPath();
                    ctx.moveTo(crossbarPoint.x - perpVec.x * crossbarHalfWidth, crossbarPoint.y - perpVec.y * crossbarHalfWidth);
                    ctx.lineTo(crossbarPoint.x + perpVec.x * crossbarHalfWidth, crossbarPoint.y + perpVec.y * crossbarHalfWidth);
                    ctx.stroke();
                    ctx.restore();
                });
            }
          }
        }
        
        const ellipseRy = showStitches ? chartEllipseRy : 0;
        cluster.stitches.forEach(stitch => drawEllipse(ctx, stitch, chartEllipseRx, ellipseRy, color, isVertical));
      });
    });
  }
}

const GrannySquareCanvas = forwardRef(({ width, height, rounds, stitchHeight, stitchWidth, showStitches, scale, selectedPaletteName, repetitionMethod }: { width: number; height: number; rounds: Round[]; stitchHeight: number; stitchWidth: number; showStitches: boolean; scale: number; selectedPaletteName: string; repetitionMethod: string; }, ref) => {
  
  useLayoutEffect(() => {
    const canvas = (ref as React.RefObject<HTMLCanvasElement>).current;
    if (!canvas || !rounds || rounds.length === 0) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(width / 2, height / 2);

    if (scale) {
        ctx.scale(scale, scale);
    }

    const palette = colorPalettes.find(p => p.name === selectedPaletteName) || colorPalettes.find(p => p.name === "Default");

    rounds.forEach((round) => {
      let color;
      if (palette && palette.name !== "Default" && palette.colors.length > 0) {
          const n = palette.colors.length;
          if (repetitionMethod === 'alternating' && n > 1) {
              const period = 2 * (n - 1);
              const effectiveIndex = round.id % period;
              const paletteIndex = effectiveIndex < n ? effectiveIndex : period - effectiveIndex;
              color = palette.colors[paletteIndex];
          } else { 
              color = palette.colors[round.id % n];
          }
      } else {
          color = `hsl(${(round.id * 55 + 180) % 360} 70% 40%)`;
      }

      drawRound(ctx, { round, rounds, color, stitchHeight, stitchWidth, showStitches });
    });
    
    ctx.restore();
  }, [width, height, rounds, stitchHeight, stitchWidth, showStitches, scale, selectedPaletteName, repetitionMethod, ref]);

  return <canvas ref={ref} />;
});


// ====== Main App Component ======
const DEFAULTS = {
    N_ROUNDS: 4,
    STITCH_WIDTH: 24,
    STITCH_HEIGHT: 24,
    SHOW_STITCHES: true,
    PALETTE_NAME: "Sunset Glow",
    REPETITION_METHOD: "sequential",
};

function GrannySquareGenerator() {
  const [nRounds, setNRounds] = useState(DEFAULTS.N_ROUNDS);
  const [stitchWidth, setStitchWidth] = useState(DEFAULTS.STITCH_WIDTH);
  const [stitchHeight, setStitchHeight] = useState(DEFAULTS.STITCH_HEIGHT);
  const [showStitches, setShowStitches] = useState(DEFAULTS.SHOW_STITCHES);
  const [selectedPaletteName, setSelectedPaletteName] = useState(DEFAULTS.PALETTE_NAME);
  const [repetitionMethod, setRepetitionMethod] = useState(DEFAULTS.REPETITION_METHOD);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const radii = useMemo(() => {
    const r: number[] = [];
    if (nRounds > 0) {
      // Always generate radius for the foundation (round 0)
      const r0 = stitchWidth / Math.sqrt(2);
      r.push(r0);
      // Generate radii for each subsequent stitch round
      for (let i = 1; i <= nRounds; i++) {
        r.push(r[i - 1] + 2.5 * stitchHeight);
      }
    }
    return r;
  }, [nRounds, stitchWidth, stitchHeight]);

  const canvasSize = 400;
  const padding = 20;

  const scale = useMemo(() => {
    if (radii.length === 0) return 1;
    const lastRadius = radii[radii.length - 1];
    const patternDimension = Math.sqrt(2) * lastRadius;
    if (patternDimension <= 0) return 1;
    const availableSpace = canvasSize - padding;
    return availableSpace / patternDimension;
  }, [radii, canvasSize, padding]);

  const rounds = useMemo(() => 
    buildRounds(radii, { x: 0, y: 0 }, stitchHeight, stitchWidth), 
    [radii, stitchHeight, stitchWidth]
  );
  
  const writtenPattern = useMemo(() => generateWrittenPattern(rounds), [rounds]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (canvas) {
        const link = document.createElement('a');
        link.download = 'granny-square-pattern.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
  };

  const handleReset = () => {
    setNRounds(DEFAULTS.N_ROUNDS);
    setStitchWidth(DEFAULTS.STITCH_WIDTH);
    setStitchHeight(DEFAULTS.STITCH_HEIGHT);
    setShowStitches(DEFAULTS.SHOW_STITCHES);
    setSelectedPaletteName(DEFAULTS.PALETTE_NAME);
    setRepetitionMethod(DEFAULTS.REPETITION_METHOD);
  };

  return (
    <>
      <style>{`
        .slider {
          -webkit-appearance: none;
          width: 100%;
          height: 8px;
          border-radius: 5px;
          background: #d3d3d3;
          outline: none;
          opacity: 0.7;
          -webkit-transition: .2s;
          transition: opacity .2s;
        }
        .slider:hover {
          opacity: 1;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
        }
      `}</style>

      <div className="max-w-4xl mx-auto p-4 bg-white font-sans">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-3">
            🧶 Granny Square Generator
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Design beautiful crochet granny square patterns with customizable colors and sizes. 
            Perfect for creating blankets, pillows, and more!
          </p>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl p-6 mb-8 border border-gray-200">
          <div className="flex flex-col items-center">
            <div className="relative bg-white rounded-xl shadow-lg p-4 mb-4">
              <GrannySquareCanvas
                ref={canvasRef}
                width={canvasSize}
                height={canvasSize}
                rounds={rounds}
                stitchHeight={stitchHeight}
                stitchWidth={stitchWidth}
                showStitches={showStitches}
                scale={scale}
                selectedPaletteName={selectedPaletteName}
                repetitionMethod={repetitionMethod}
              />
              <button 
                onClick={handleDownload} 
                className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-md transition-colors"
                title="Download Pattern"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            </div>
            
            <div className="text-sm text-gray-600 text-center">
              Click the download button to save your pattern as a PNG.
            </div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-6 mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">✨ Customize Your Pattern</h2>
            <button 
              onClick={handleReset}
              className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
            >
              Reset
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rounds: {nRounds}
              </label>
              <input 
                type="range" 
                min="1" 
                max="8" 
                value={nRounds}
                onChange={(e) => setNRounds(Math.max(1, Number(e.target.value) || 1))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1</span>
                <span>8</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color Palette
              </label>
              <select 
                value={selectedPaletteName} 
                onChange={e => setSelectedPaletteName(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                {colorPalettes.filter(p=>p.name !== "Default").map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Color Order
              </label>
              <select 
                value={repetitionMethod} 
                onChange={e => setRepetitionMethod(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="sequential">Sequential</option>
                <option value="alternating">Alternating</option>
              </select>
            </div>
            
            <div className="flex items-center justify-center md:col-span-2 lg:col-span-1 lg:justify-start">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStitches}
                  onChange={() => setShowStitches(!showStitches)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium text-gray-700">Show Stitch Details</span>
              </label>
            </div>
          </div>

          <div className="mt-6 p-4 bg-white rounded-lg border border-gray-200">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Current Palette Preview:</h3>
            <div className="flex space-x-2">
              {colorPalettes.find(p => p.name === selectedPaletteName)?.colors.map((color, index) => (
                <div 
                  key={index}
                  className="w-8 h-8 rounded-full border-2 border-white shadow-md"
                  style={{ backgroundColor: color }}
                  title={`Color ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </div>

        <details className="bg-gray-50 rounded-xl mb-8 overflow-hidden">
          <summary className="p-4 cursor-pointer font-medium text-gray-800 hover:bg-gray-100 transition-colors">
            ⚙️ Advanced Settings
          </summary>
          <div className="p-4 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stitch Width: {stitchWidth}px
                </label>
                <input 
                  type="range" 
                  min="8" 
                  max="40" 
                  value={stitchWidth}
                  onChange={(e) => setStitchWidth(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stitch Height: {stitchHeight}px
                </label>
                <input 
                  type="range" 
                  min="8" 
                  max="40" 
                  value={stitchHeight}
                  onChange={(e) => setStitchHeight(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
            </div>
          </div>
        </details>

        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
            📋 Written Pattern Instructions
          </h2>
          <div className="bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
            {writtenPattern}
          </div>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> The visual diagram is a schematic representation. The written instructions follow the standard method for a classic granny square.
            </p>
            <p className="text-sm text-blue-800 mt-1">
              <strong>Abbreviations:</strong> Ch = Chain, DC = Double Crochet, Sl st = Slip Stitch
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default GrannySquareGenerator;
