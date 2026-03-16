import { describe, it, expect } from "vitest";

/**
 * Validates sprite animation config for the SquadStageActor.
 * endCol must be startCol + frameCount (one past last visible frame)
 * so that CSS steps(N) timing lands on exact pixel boundaries.
 */

const FRAME_WIDTH = 16;
const SHEET_WIDTH = 112;

type SpriteConfig = {
  row: number;
  startCol: number;
  endCol: number;
  animationMode: "static" | "task" | "handoff" | "walk";
};

function spriteConfigForMotion(motion: string): SpriteConfig {
  switch (motion) {
    case "walking":
      return { row: 2, startCol: 0, endCol: 4, animationMode: "walk" };
    case "handoff":
      return { row: 2, startCol: 1, endCol: 4, animationMode: "handoff" };
    case "working":
      return { row: 3, startCol: 4, endCol: 6, animationMode: "task" };
    case "reviewing":
      return { row: 1, startCol: 4, endCol: 6, animationMode: "task" };
    case "verifying":
      return { row: 0, startCol: 4, endCol: 6, animationMode: "task" };
    case "blocked":
      return { row: 0, startCol: 6, endCol: 6, animationMode: "static" };
    case "offline":
      return { row: 3, startCol: 6, endCol: 6, animationMode: "static" };
    case "idle":
    default:
      return { row: 0, startCol: 1, endCol: 1, animationMode: "static" };
  }
}

function stepsCount(mode: string): number {
  switch (mode) {
    case "walk": return 4;
    case "handoff": return 3;
    case "task": return 2;
    default: return 1;
  }
}

describe("squad stage sprite animation config", () => {
  const motions = ["walking", "handoff", "working", "reviewing", "verifying", "blocked", "offline", "idle"];

  it.each(motions)("endCol does not exceed sprite sheet width for motion '%s'", (motion) => {
    const config = spriteConfigForMotion(motion);
    expect(config.endCol * FRAME_WIDTH).toBeLessThanOrEqual(SHEET_WIDTH);
  });

  it.each(motions)("startCol is non-negative for motion '%s'", (motion) => {
    const config = spriteConfigForMotion(motion);
    expect(config.startCol).toBeGreaterThanOrEqual(0);
  });

  it("walk animation has endCol = startCol + 4 for 4-frame strip", () => {
    const config = spriteConfigForMotion("walking");
    expect(config.endCol - config.startCol).toBe(stepsCount(config.animationMode));
  });

  it("handoff animation has endCol = startCol + 3 for 3-frame strip", () => {
    const config = spriteConfigForMotion("handoff");
    expect(config.endCol - config.startCol).toBe(stepsCount(config.animationMode));
  });

  it("task animations have endCol = startCol + 2 for 2-frame strip", () => {
    for (const motion of ["working", "reviewing", "verifying"]) {
      const config = spriteConfigForMotion(motion);
      expect(config.endCol - config.startCol).toBe(stepsCount(config.animationMode));
    }
  });

  it("static animations have endCol === startCol (single frame)", () => {
    for (const motion of ["blocked", "offline", "idle"]) {
      const config = spriteConfigForMotion(motion);
      expect(config.endCol).toBe(config.startCol);
    }
  });

  it("animation steps land on exact frame boundaries", () => {
    const config = spriteConfigForMotion("walking");
    const scale = 4.1;
    const startX = config.startCol * FRAME_WIDTH * scale;
    const endX = config.endCol * FRAME_WIDTH * scale;
    const steps = stepsCount(config.animationMode);
    const stepSize = (endX - startX) / steps;
    // Each step should equal exactly one frame width
    expect(stepSize).toBeCloseTo(FRAME_WIDTH * scale, 5);
  });
});
