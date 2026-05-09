import type { MediaItem } from "@openreel/core";

const MB = 1024 * 1024;

export const EDITOR_RESOURCE_SOFT_LIMIT_BYTES = 600 * MB;
export const EDITOR_RESOURCE_HARD_LIMIT_BYTES = 700 * MB;

function getMediaSize(item: MediaItem) {
  return item.metadata.fileSize || item.sourceFile?.size || item.blob?.size || 0;
}

export function getManagedMediaBytes(items: MediaItem[]) {
  return items.reduce((total, item) => total + getMediaSize(item), 0);
}

export function formatResourceBytes(bytes: number) {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

export function checkEditorResourceBudget(
  items: MediaItem[],
  nextFile: File,
  options: { replaceMediaId?: string } = {},
) {
  const existingItem = options.replaceMediaId
    ? items.find((item) => item.id === options.replaceMediaId)
    : undefined;
  const existingBytes = existingItem ? getMediaSize(existingItem) : 0;
  const currentBytes = getManagedMediaBytes(items);
  const projectedBytes = currentBytes - existingBytes + nextFile.size;

  return {
    currentBytes,
    projectedBytes,
    softExceeded: projectedBytes > EDITOR_RESOURCE_SOFT_LIMIT_BYTES,
    hardExceeded: projectedBytes > EDITOR_RESOURCE_HARD_LIMIT_BYTES,
    message: `Editor resource budget exceeded: ${formatResourceBytes(projectedBytes)} of ${formatResourceBytes(
      EDITOR_RESOURCE_HARD_LIMIT_BYTES,
    )}. Remove unused media or import a smaller file.`,
  };
}
