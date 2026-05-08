import { getExportEngine, type VideoExportSettings } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { useTimelineStore } from "../stores/timeline-store";
import { useUIStore } from "../stores/ui-store";
import { toast } from "../stores/notification-store";

type ApgenImportMessage = {
  source?: string;
  type?: string;
  file: File;
  payload?: {
    addToTimeline?: boolean;
    startTime?: number;
  };
};

type ApgenValidateEditingMessage = {
  source?: string;
  type?: string;
  payload?: {
    mediaId?: string;
    clipId?: string;
  };
};

type ApgenExportEditedMessage = {
  source?: string;
  type?: string;
  payload?: {
    fileName?: string;
    settings?: Partial<VideoExportSettings>;
  };
};

type ApgenParentSuccessMessage =
  | {
      source?: string;
      type?: "APGEN_SCREEN_RECORDING_RESULT";
      requestId?: string;
      ok?: true;
      file?: File;
      payload?: {
        addToTimeline?: boolean;
        startTime?: number;
      };
    }
  | {
      source?: string;
      type?: "APGEN_DRIVE_UPLOAD_RESULT";
      requestId?: string;
      ok?: true;
      result?: {
        fileId: string;
        fileName: string;
        webViewLink: string | null;
        folderId: string;
        folderName: string;
      };
    }
  | {
      source?: string;
      type?: "APGEN_APPLY_VIDEO_SLIDE_RESULT";
      requestId?: string;
      ok?: true;
      result?: {
        applied: boolean;
        message: string;
      };
    };

type ApgenParentErrorMessage = {
  source?: string;
  type?: "APGEN_ACTION_ERROR";
  requestId?: string;
  ok?: false;
  error?: string;
  recoverable?: boolean;
};

type ApgenParentMessage = ApgenParentSuccessMessage | ApgenParentErrorMessage;

type ApgenBridgeMessage =
  | ApgenImportMessage
  | ApgenValidateEditingMessage
  | ApgenExportEditedMessage;

const isApgenImportMessage = (data: unknown): data is ApgenImportMessage => {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<ApgenImportMessage>;
  return (
    message.source === "apgen" &&
    message.type === "APGEN_OPENREEL_IMPORT_MEDIA" &&
    message.file instanceof File
  );
};

const isApgenValidateEditingMessage = (
  data: unknown,
): data is ApgenValidateEditingMessage => {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<ApgenValidateEditingMessage>;
  return (
    message.source === "apgen" &&
    message.type === "APGEN_OPENREEL_VALIDATE_EDITING"
  );
};

const isApgenExportEditedMessage = (
  data: unknown,
): data is ApgenExportEditedMessage => {
  if (!data || typeof data !== "object") return false;
  const message = data as Partial<ApgenExportEditedMessage>;
  return (
    message.source === "apgen" &&
    message.type === "APGEN_OPENREEL_EXPORT_EDITED"
  );
};

let bridgeInstalled = false;

const createRequestId = () =>
  `apgen-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const parseHashParams = () => {
  if (typeof window === "undefined") return new URLSearchParams();
  const [, queryString = ""] = window.location.hash.split("?");
  return new URLSearchParams(queryString);
};

export function isApgenIntegrationMode() {
  if (typeof window === "undefined") return false;
  const envEnabled = import.meta.env.VITE_APGEN_INTEGRATION_MODE === "true";
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = parseHashParams();
  return (
    envEnabled ||
    searchParams.get("integration") === "apgen" ||
    hashParams.get("integration") === "apgen"
  );
}

const hasParentWindow = () =>
  typeof window !== "undefined" && window.parent && window.parent !== window;

function requestApgenParent<T>(
  type: string,
  payload: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<T> {
  if (!isApgenIntegrationMode() || !hasParentWindow()) {
    return Promise.reject(new Error("APGen integration parent is not available"));
  }

  const requestId = createRequestId();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("APGen did not respond in time"));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent<ApgenParentMessage>) => {
      if (event.source !== window.parent) return;
      if (event.data?.source !== "apgen") return;
      if (event.data?.requestId !== requestId) return;

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);

      if (event.data.type === "APGEN_ACTION_ERROR" || event.data.ok === false) {
        reject(new Error(event.data.error || "APGen action failed"));
        return;
      }

      resolve(event.data as T);
    };

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({
      source: "openreel",
      type,
      requestId,
      payload,
    }, "*");
  });
}

export function notifyApgenEditorEvent(
  event: "ready" | "media-imported" | "export-started" | "export-finished" | "drive-uploaded",
  metadata: Record<string, unknown> = {},
) {
  if (!isApgenIntegrationMode() || !hasParentWindow()) return;
  window.parent.postMessage({
    source: "openreel",
    type: "APGEN_EDITOR_EVENT",
    payload: { event, metadata },
  }, "*");
}

const postBridgeResult = (
  event: MessageEvent<ApgenBridgeMessage>,
  type: string,
  payload: Record<string, unknown>,
) => {
  event.source?.postMessage({
    source: "openreel",
    type,
    ...payload,
  }, { targetOrigin: event.origin || "*" });
};

const getEditableClip = (mediaId?: string, clipId?: string) => {
  const { project } = useProjectStore.getState();
  for (const track of project.timeline.tracks) {
    if (track.type !== "video" && track.type !== "image") continue;
    const clip = track.clips.find((item) => {
      if (clipId) return item.id === clipId;
      if (mediaId) return item.mediaId === mediaId;
      return true;
    });
    if (clip) return { clip, track };
  }
  return null;
};

const getClipsByMedia = (mediaId: string) => {
  const { project } = useProjectStore.getState();
  return project.timeline.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clip.mediaId === mediaId)
      .map((clip) => ({ clip, track })),
  );
};

const assertAction = async (
  label: string,
  action: Promise<{ success: boolean; error?: { message?: string } }>,
) => {
  const result = await action;
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error?.message || "unknown error"}`);
  }
  return result;
};

const createMemoryWritableFile = (mimeType: string) => {
  let buffer = new Uint8Array(16 * 1024 * 1024);
  let length = 0;
  let cursor = 0;

  const grow = (needed: number) => {
    if (needed <= buffer.length) return;
    let nextSize = buffer.length;
    while (nextSize < needed) nextSize *= 2;
    const next = new Uint8Array(nextSize);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };

  const writeBytes = (bytes: Uint8Array, position: number) => {
    const end = position + bytes.byteLength;
    grow(end);
    buffer.set(bytes, position);
    length = Math.max(length, end);
    cursor = end;
  };

  return {
    writable: {
      seek(position: number) {
        cursor = position;
        return Promise.resolve();
      },
      write(data: unknown) {
        if (data instanceof ArrayBuffer) {
          writeBytes(new Uint8Array(data), cursor);
        } else if (ArrayBuffer.isView(data)) {
          writeBytes(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            cursor,
          );
        } else if (
          data &&
          typeof data === "object" &&
          "data" in data &&
          ArrayBuffer.isView((data as { data: ArrayBufferView }).data)
        ) {
          const view = (data as { data: ArrayBufferView }).data;
          writeBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), cursor);
        }
        return Promise.resolve();
      },
      close() {
        return Promise.resolve();
      },
      abort() {
        length = 0;
        return Promise.resolve();
      },
      truncate(size: number) {
        length = Math.min(length, size);
        if (cursor > length) cursor = length;
        return Promise.resolve();
      },
    } as unknown as FileSystemWritableFileStream,
    getBlob() {
      return new Blob([buffer.slice(0, length)], { type: mimeType });
    },
  };
};

const getExportDuration = () => {
  const { project } = useProjectStore.getState();
  return project.timeline.tracks.reduce((max, track) => {
    return track.clips.reduce(
      (trackMax, clip) => Math.max(trackMax, clip.startTime + clip.duration),
      max,
    );
  }, project.timeline.duration || 0);
};

const runEditedExport = async (message: ApgenExportEditedMessage) => {
  const { project } = useProjectStore.getState();
  const duration = getExportDuration();
  if (duration <= 0) {
    throw new Error("Timeline is empty. Import and edit a video before exporting.");
  }

  const exportSettings: Partial<VideoExportSettings> = {
    format: "webm",
    codec: "vp8",
    width: Math.min(project.settings.width || 1280, 1280),
    height: Math.min(project.settings.height || 720, 720),
    frameRate: Math.min(project.settings.frameRate || 30, 30),
    bitrate: 2500,
    quality: 75,
    audioSettings: {
      format: "ogg",
      sampleRate: 48000,
      bitDepth: 16,
      bitrate: 128,
      channels: 2,
    },
    ...message.payload?.settings,
  };
  const ext = exportSettings.format === "mp4" ? "mp4" : exportSettings.format === "mov" ? "mov" : "webm";
  const mimeType =
    ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : "video/webm";
  const fileName =
    message.payload?.fileName ||
    `${project.name || "apgen-video-editado"}.${ext}`;
  const memoryFile = createMemoryWritableFile(mimeType);
  const engine = getExportEngine();
  await engine.initialize();

  useUIStore.getState().setExportState({
    isExporting: true,
    progress: 0,
    phase: "Initializing...",
  });

  const generator = engine.exportVideo(project, exportSettings, memoryFile.writable);
  let finalResult;
  while (true) {
    const { value, done } = await generator.next();
    if (done) {
      finalResult = value;
      break;
    }
    useUIStore.getState().setExportState({
      isExporting: true,
      progress: Math.round(value.progress * 100),
      phase: value.phase === "complete" ? "Complete!" : `${value.phase}...`,
    });
  }

  if (!finalResult?.success) {
    throw new Error(finalResult?.error?.message || "Export failed");
  }

  const blob = memoryFile.getBlob();
  if (!blob.size) {
    throw new Error("Export returned an empty file");
  }

  useUIStore.getState().setExportState({
    isExporting: false,
    progress: 100,
    phase: "Complete!",
  });

  return {
    blob,
    fileName,
    mimeType,
    durationSec: Math.ceil(duration),
    sizeBytes: blob.size,
    recordingKind: "edited",
    stats: finalResult.stats,
  };
};

export async function exportApgenEditedVideo(options: {
  fileName?: string;
  settings?: Partial<VideoExportSettings>;
} = {}) {
  notifyApgenEditorEvent("export-started", {
    fileName: options.fileName,
    format: options.settings?.format,
  });
  const result = await runEditedExport({
    source: "apgen",
    type: "APGEN_OPENREEL_EXPORT_EDITED",
    payload: options,
  });
  notifyApgenEditorEvent("export-finished", {
    fileName: result.fileName,
    mimeType: result.mimeType,
    durationSec: result.durationSec,
    sizeBytes: result.sizeBytes,
  });
  return result;
}

export async function requestApgenScreenRecording(options: {
  includeMicrophone?: boolean;
  title?: string;
}) {
  return requestApgenParent<Extract<ApgenParentSuccessMessage, { type?: "APGEN_SCREEN_RECORDING_RESULT" }>>(
    "APGEN_REQUEST_SCREEN_RECORDING",
    {
      includeMicrophone: options.includeMicrophone ?? true,
      title: options.title || "openreel",
    },
    10 * 60 * 1000,
  );
}

export async function requestApgenDriveUpload(payload: {
  fileName: string;
  mimeType: string;
  durationSec: number;
  sizeBytes: number;
  blob: Blob;
}) {
  const response = await requestApgenParent<Extract<ApgenParentSuccessMessage, { type?: "APGEN_DRIVE_UPLOAD_RESULT" }>>(
    "APGEN_REQUEST_DRIVE_UPLOAD",
    payload as unknown as Record<string, unknown>,
    10 * 60 * 1000,
  );
  if (response.result) {
    notifyApgenEditorEvent("drive-uploaded", {
      fileName: response.result.fileName,
      fileId: response.result.fileId,
      folderId: response.result.folderId,
    });
  }
  return response;
}

export async function requestApgenApplyVideoSlide(payload: {
  fileId: string;
  fileName: string;
  webViewLink: string;
}) {
  return requestApgenParent<Extract<ApgenParentSuccessMessage, { type?: "APGEN_APPLY_VIDEO_SLIDE_RESULT" }>>(
    "APGEN_REQUEST_APPLY_VIDEO_SLIDE",
    payload,
    120000,
  );
}

const runEditingValidation = async (message: ApgenValidateEditingMessage) => {
  const store = useProjectStore.getState();
  const target = getEditableClip(message.payload?.mediaId, message.payload?.clipId);
  if (!target) {
    throw new Error("No editable video/image clip found on timeline");
  }

  const originalClip = target.clip;
  const inPoint = originalClip.inPoint || 0;
  const usableDuration = Math.max(0.8, Math.min(originalClip.duration, originalClip.outPoint - inPoint));
  if (usableDuration < 0.8 || originalClip.duration < 0.8) {
    throw new Error("Clip is too short for ORE-4 editing validation");
  }

  const trimIn = inPoint + Math.min(0.15, usableDuration * 0.1);
  const trimOut = inPoint + Math.max(0.65, usableDuration - Math.min(0.15, usableDuration * 0.1));
  await assertAction("trim", store.trimClip(originalClip.id, trimIn, trimOut));

  const afterTrim = getEditableClip(originalClip.mediaId, originalClip.id)?.clip;
  if (!afterTrim) throw new Error("Clip disappeared after trim");

  const movedStartTime = afterTrim.startTime + 0.25;
  await assertAction("move", store.moveClip(afterTrim.id, movedStartTime, afterTrim.trackId));

  const afterMove = getEditableClip(afterTrim.mediaId, afterTrim.id)?.clip;
  if (!afterMove) throw new Error("Clip disappeared after move");

  const splitTime = afterMove.startTime + Math.max(0.25, Math.min(afterMove.duration / 2, afterMove.duration - 0.25));
  await assertAction("split", store.splitClip(afterMove.id, splitTime));

  const splitClips = getClipsByMedia(originalClip.mediaId).filter(({ clip }) => {
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime >= afterMove.startTime && clipEnd <= afterMove.startTime + afterMove.duration + 0.01;
  });
  if (splitClips.length < 2) {
    throw new Error("Split did not create a second clip");
  }

  await assertAction("undo", store.undo());
  const afterUndo = getClipsByMedia(originalClip.mediaId).filter(({ clip }) => {
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime >= afterMove.startTime && clipEnd <= afterMove.startTime + afterMove.duration + 0.01;
  });
  if (afterUndo.length !== 1) {
    throw new Error("Undo did not restore the split clip count");
  }

  await assertAction("redo", store.redo());
  const afterRedo = getClipsByMedia(originalClip.mediaId).filter(({ clip }) => {
    const clipEnd = clip.startTime + clip.duration;
    return clip.startTime >= afterMove.startTime && clipEnd <= afterMove.startTime + afterMove.duration + 0.01;
  });
  if (afterRedo.length < 2) {
    throw new Error("Redo did not reapply split");
  }

  const firstClip = afterRedo.sort((a, b) => a.clip.startTime - b.clip.startTime)[0].clip;
  useUIStore.getState().select({ type: "clip", id: firstClip.id, trackId: firstClip.trackId });
  useTimelineStore.getState().seekTo(firstClip.startTime + Math.min(0.1, firstClip.duration / 2));
  useTimelineStore.getState().pause();

  const refreshedStore = useProjectStore.getState();
  const blurEffect = refreshedStore.addVideoEffect(firstClip.id, "blur", { radius: 18 });
  if (!blurEffect) {
    throw new Error("Initial hiding validation failed: blur effect was not applied");
  }

  return {
    clipId: firstClip.id,
    mediaId: firstClip.mediaId,
    operations: ["trim", "move", "split", "undo", "redo", "preview-seek", "blur"],
    blurEffectId: blurEffect.id,
    playheadPosition: useTimelineStore.getState().playheadPosition,
    clipCount: afterRedo.length,
  };
};

export function installApgenBridge() {
  if (bridgeInstalled || typeof window === "undefined") return;
  bridgeInstalled = true;
  notifyApgenEditorEvent("ready");

  window.addEventListener("message", async (event) => {
    if (isApgenValidateEditingMessage(event.data)) {
      try {
        const result = await runEditingValidation(event.data);
        postBridgeResult(event, "APGEN_OPENREEL_EDITING_VALIDATION_RESULT", {
          ok: true,
          result,
        });
        toast.success("APGen ORE-4 validation", "Minimal editing flow passed");
      } catch (error) {
        const validationError = error instanceof Error ? error.message : "Unknown validation error";
        postBridgeResult(event, "APGEN_OPENREEL_EDITING_VALIDATION_RESULT", {
          ok: false,
          error: validationError,
        });
        toast.error("APGen ORE-4 validation failed", validationError);
      }
      return;
    }

    if (isApgenExportEditedMessage(event.data)) {
      try {
        const result = await runEditedExport(event.data);
        postBridgeResult(event, "APGEN_OPENREEL_EXPORT_EDITED_RESULT", {
          ok: true,
          result,
        });
        toast.success("APGen export complete", result.fileName);
      } catch (error) {
        useUIStore.getState().setExportState({
          isExporting: false,
          progress: 0,
          phase: "",
        });
        const exportError = error instanceof Error ? error.message : "Unknown export error";
        postBridgeResult(event, "APGEN_OPENREEL_EXPORT_EDITED_RESULT", {
          ok: false,
          error: exportError,
        });
        toast.error("APGen export failed", exportError);
      }
      return;
    }

    if (!isApgenImportMessage(event.data)) return;

    const { file, payload } = event.data;
    const { importMedia, addClipToNewTrack } = useProjectStore.getState();

    try {
      const beforeIds = new Set(
        useProjectStore.getState().project.mediaLibrary.items.map((item) => item.id),
      );
      const result = await importMedia(file);

      if (!result.success) {
        const message = result.error?.message || "Failed to import media";
        postBridgeResult(event, "APGEN_OPENREEL_IMPORT_RESULT", {
          ok: false,
          fileName: file.name,
          error: message,
        });
        toast.error("APGen import failed", message);
        return;
      }

      let mediaId = result.actionId;
      if (!mediaId) {
        mediaId = useProjectStore
          .getState()
          .project.mediaLibrary.items.find((item) => !beforeIds.has(item.id))?.id;
      }

      if (payload?.addToTimeline !== false && mediaId) {
        await addClipToNewTrack(mediaId, payload?.startTime || 0);
      }

      postBridgeResult(event, "APGEN_OPENREEL_IMPORT_RESULT", {
        ok: true,
        fileName: file.name,
        mediaId,
      });
      toast.success("Imported from APGen", file.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import error";
      postBridgeResult(event, "APGEN_OPENREEL_IMPORT_RESULT", {
        ok: false,
        fileName: file.name,
        error: message,
      });
      toast.error("APGen import failed", message);
    }
  });
}
