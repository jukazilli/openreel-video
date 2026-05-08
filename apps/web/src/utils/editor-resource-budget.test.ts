import { describe, expect, it } from "vitest";
import type { MediaItem } from "@openreel/core";
import {
  checkEditorResourceBudget,
  EDITOR_RESOURCE_HARD_LIMIT_BYTES,
  EDITOR_RESOURCE_SOFT_LIMIT_BYTES,
  getManagedMediaBytes,
} from "./editor-resource-budget";

function mediaItem(id: string, size: number): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    fileHandle: null,
    blob: new File(["x"], `${id}.mp4`),
    metadata: {
      duration: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      sampleRate: 0,
      channels: 0,
      fileSize: size,
    },
    thumbnailUrl: null,
    waveformData: null,
  };
}

function file(size: number) {
  return { name: "next.mp4", size, type: "video/mp4" } as File;
}

describe("editor resource budget", () => {
  it("sums managed media bytes", () => {
    expect(getManagedMediaBytes([mediaItem("a", 10), mediaItem("b", 20)])).toBe(30);
  });

  it("warns above soft limit and blocks above hard limit", () => {
    const items = [mediaItem("a", EDITOR_RESOURCE_SOFT_LIMIT_BYTES - 1)];

    expect(checkEditorResourceBudget(items, file(2)).softExceeded).toBe(true);
    expect(checkEditorResourceBudget(items, file(EDITOR_RESOURCE_HARD_LIMIT_BYTES)).hardExceeded).toBe(true);
  });

  it("subtracts replaced asset size before calculating projected bytes", () => {
    const items = [mediaItem("old", EDITOR_RESOURCE_HARD_LIMIT_BYTES - 1)];

    const result = checkEditorResourceBudget(items, file(1024), {
      replaceMediaId: "old",
    });

    expect(result.hardExceeded).toBe(false);
  });
});
