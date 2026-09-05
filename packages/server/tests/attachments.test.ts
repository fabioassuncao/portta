import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
  contentDisposition,
  normaliseContentType,
  rejectUpload,
  safeFilename,
} from '../src/services/attachments.ts'

describe('what an attachment is called', () => {
  it('keeps one path segment and nothing that could escape it', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('C:\\Users\\me\\shot.png')).toBe('shot.png')
    expect(safeFilename('report.pdf')).toBe('report.pdf')
  })

  it('refuses to end up with an empty or hidden name', () => {
    expect(safeFilename('')).toBe('attachment')
    expect(safeFilename('   ')).toBe('attachment')
    expect(safeFilename('..')).toBe('attachment')
    expect(safeFilename('.env')).toBe('env')
  })

  it('drops control characters that would break a header', () => {
    expect(safeFilename('log\n\r.txt')).toBe('log.txt')
  })

  it('truncates a name rather than refusing it', () => {
    expect(safeFilename(`${'a'.repeat(400)}.png`)).toHaveLength(ATTACHMENT_LIMITS.maxFilenameLength)
  })
})

describe('what an attachment is', () => {
  it('trusts a declared type only when it is one the panel will render', () => {
    expect(normaliseContentType('image/png', 'shot.png')).toBe('image/png')
    expect(normaliseContentType('text/plain; charset=utf-8', 'a.txt')).toBe('text/plain')
  })

  it('falls back to the extension when the browser sent nothing useful', () => {
    expect(normaliseContentType('', 'trace.log')).toBe('text/plain')
    expect(normaliseContentType('application/octet-stream', 'payload.json')).toBe('application/json')
  })

  it('stores anything it does not recognise as a download', () => {
    expect(normaliseContentType('application/x-msdownload', 'setup.exe')).toBe('application/octet-stream')
    expect(attachmentKind('application/octet-stream')).toBe('file')
  })

  it('never treats SVG as a renderable image', () => {
    // It can carry script, and it would be served from the panel's own origin.
    expect(normaliseContentType('image/svg+xml', 'icon.svg')).toBe('application/octet-stream')
    expect(attachmentKind('image/svg+xml')).toBe('file')
  })

  it('knows what it can show inline', () => {
    expect(attachmentKind('image/png')).toBe('image')
    expect(attachmentKind('application/pdf')).toBe('pdf')
    expect(attachmentKind('application/json')).toBe('text')
  })
})

describe('what an upload is refused for', () => {
  it('accepts an ordinary file', () => {
    expect(rejectUpload({ sizeBytes: 1024, existingCount: 0 })).toBeNull()
  })

  it('says how big the file was and what the limit is', () => {
    const rejection = rejectUpload({ sizeBytes: ATTACHMENT_LIMITS.maxBytes + 1, existingCount: 0 })
    expect(rejection?.reason).toBe('too-large')
    expect(rejection?.detail).toContain('10 MB')
  })

  it('refuses an empty file rather than storing a zero-byte row', () => {
    expect(rejectUpload({ sizeBytes: 0, existingCount: 0 })?.reason).toBe('empty')
  })

  it('caps how many one task may carry', () => {
    expect(rejectUpload({ sizeBytes: 10, existingCount: ATTACHMENT_LIMITS.maxPerTask })?.reason).toBe('too-many')
    expect(rejectUpload({ sizeBytes: 10, existingCount: ATTACHMENT_LIMITS.maxPerTask - 1 })).toBeNull()
  })
})

describe('how the bytes are served', () => {
  it('shows an image and downloads everything else', () => {
    expect(contentDisposition('shot.png', 'image/png')).toMatch(/^inline;/)
    expect(contentDisposition('trace.log', 'text/plain')).toMatch(/^attachment;/)
    expect(contentDisposition('setup.exe', 'application/octet-stream')).toMatch(/^attachment;/)
  })

  it('survives a name a header cannot hold literally', () => {
    const header = contentDisposition('relatório final.pdf', 'application/pdf')
    expect(header).toContain('filename="relat_rio final.pdf"')
    expect(header).toContain("filename*=UTF-8''relat%C3%B3rio%20final.pdf")
  })

  it('cannot be talked into breaking out of the quoted filename', () => {
    expect(contentDisposition('a"; drop.txt', 'text/plain')).not.toContain('a";')
  })
})
