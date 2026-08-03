import type { FileAttachment } from 'src/api/search';

export function inlineUrl(file: FileAttachment): string {
  return `/api/files/${file.id}/download?inline=1`;
}

export function downloadUrl(file: FileAttachment): string {
  return `/api/files/${file.id}/download`;
}

export function fileIcon(file: FileAttachment): string {
  return file.fileType === 'PDF' ? 'picture_as_pdf' : file.fileType === 'IMAGE' ? 'image' : 'draft';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
