// What may be attached to a task, and what it is called once it is.
//
// Pure over its inputs so the rules can be tested without a database or an
// HTTP request: the routes decide nothing about size, type or naming, they
// only apply what is decided here.

/**
 * The limits, in one place, because a limit that lives in three places is
 * three different limits. The database repeats the per-file cap as a CHECK.
 */
export const ATTACHMENT_LIMITS = {
  /** 10 MiB. Enough for a screenshot, a log or a heap of JSON; not a video. */
  maxBytes: 10 * 1024 * 1024,
  /** Per task. A task needing more than this is a task that needs a branch. */
  maxPerTask: 25,
  maxFilenameLength: 255,
} as const

/**
 * The types the panel will accept and, for the ones it will render inline,
 * what it renders them as.
 *
 * An allowlist rather than a denylist. The panel serves these bytes back to a
 * browser, and the difference between "a file the operator uploaded" and "a
 * script that runs on the panel's own origin" is exactly this list. Anything
 * not here is still storable — it is stored as application/octet-stream and
 * only ever downloaded, never rendered.
 */
const RENDERABLE: Record<string, 'image' | 'text' | 'pdf'> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'application/pdf': 'pdf',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'application/json': 'text',
  'application/x-ndjson': 'text',
  'text/x-log': 'text',
}

export type AttachmentKind = 'image' | 'text' | 'pdf' | 'file'

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  ndjson: 'application/x-ndjson',
  yml: 'text/plain',
  yaml: 'text/plain',
}

export function attachmentKind(contentType: string): AttachmentKind {
  return RENDERABLE[contentType.toLowerCase()] ?? 'file'
}

/**
 * SVG is an image the way a document is an image: it can carry script, and it
 * would be served from the panel's own origin. It is stored as a download
 * rather than rendered, which is what makes the allowlist above safe.
 */
export function normaliseContentType(declared: string | null | undefined, filename: string): string {
  const cleaned = (declared ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (cleaned && RENDERABLE[cleaned]) return cleaned
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  const guessed = EXTENSION_TYPES[extension]
  if (guessed) return guessed
  return 'application/octet-stream'
}

/**
 * A filename that is safe to store, to echo back and to put in a
 * Content-Disposition header: one path segment, no control characters, no
 * traversal, never empty.
 */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  if (cleaned === '') return 'attachment'
  return cleaned.slice(0, ATTACHMENT_LIMITS.maxFilenameLength)
}

export interface AttachmentRejection {
  reason: 'too-large' | 'empty' | 'too-many'
  detail: string
}

/** Why this upload cannot be accepted, in words the panel can show as-is. */
export function rejectUpload(input: { sizeBytes: number; existingCount: number }): AttachmentRejection | null {
  if (input.sizeBytes <= 0) {
    return { reason: 'empty', detail: 'the file is empty' }
  }
  if (input.sizeBytes > ATTACHMENT_LIMITS.maxBytes) {
    return {
      reason: 'too-large',
      detail: `the file is ${Math.round(input.sizeBytes / 1024 / 1024)} MB and the limit is ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB`,
    }
  }
  if (input.existingCount >= ATTACHMENT_LIMITS.maxPerTask) {
    return {
      reason: 'too-many',
      detail: `this task already has ${ATTACHMENT_LIMITS.maxPerTask} attachments`,
    }
  }
  return null
}

/**
 * The Content-Disposition for a download.
 *
 * `attachment` for everything the browser would not render safely, `inline`
 * for the ones it will — an image opened from a task should appear, not
 * download. The filename goes out RFC 5987 encoded so a name with a space or
 * an accent survives.
 */
export function contentDisposition(filename: string, contentType: string): string {
  const kind = attachmentKind(contentType)
  const mode = kind === 'image' || kind === 'pdf' ? 'inline' : 'attachment'
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
