'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import type { TaskAttachment } from 'portta-contracts'
import { Button } from '../ui/button.tsx'
import { ConfirmDialog } from '../ui/confirm-dialog.tsx'
import { useToast } from '../ui/toast.tsx'
import { SectionHeader } from '../shell-bits.tsx'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'

/** Mirrors ATTACHMENT_LIMITS in src/server/core/attachments.ts. */
const MAX_MB = 10

const ICON = {
  image: ImageIcon,
  pdf: FileText,
  text: FileText,
  file: Paperclip,
} as const

/**
 * The files that belong to a task: the screenshot of the bug, the log that
 * proves it, the JSON the API actually returned.
 *
 * Three ways in, because all three are how people actually attach things: a
 * file picker, a drop onto the panel, and a paste straight from the clipboard
 * — which is what a screenshot is, and the one that saves a round trip through
 * the filesystem. Removal is confirmed by name, because the bytes are gone.
 */
export function TaskAttachments({
  attachments,
  readOnly = false,
  busy = false,
  onUpload,
  onRemove,
}: {
  attachments: readonly TaskAttachment[]
  readOnly?: boolean
  busy?: boolean
  onUpload: (files: File[]) => void
  onRemove: (attachment: TaskAttachment) => void
}) {
  const { t } = useTranslation('tasks', { keyPrefix: 'attachments' })
  const { bytes, relativeTime } = useFormat()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const region = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  const [pending, setPending] = useState<TaskAttachment | null>(null)

  // A screenshot is on the clipboard, not on disk. Pasting one anywhere in
  // this section attaches it, which is the shortest path there is.
  useEffect(() => {
    const element = region.current
    if (!element || readOnly) return
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      onUpload(files.map((file) => (file.name ? file : renamed(file, t('pasted', { time: Date.now() })))))
    }
    element.addEventListener('paste', onPaste as EventListener)
    return () => element.removeEventListener('paste', onPaste as EventListener)
  }, [onUpload, readOnly, t])

  return (
    <section
      ref={region}
      // Focusable so a paste lands here without a click first.
      tabIndex={readOnly ? undefined : 0}
      onDragOver={(event) => {
        if (readOnly) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (readOnly) return
        event.preventDefault()
        setOver(false)
        const files = [...event.dataTransfer.files]
        if (files.length > 0) onUpload(files)
      }}
      className={cn(
        'space-y-2 rounded-md transition-colors focus-ring',
        over && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
      )}
    >
      <div>
        <SectionHeader
          title={t('title', { count: attachments.length })}
          count={busy ? <Loader2 className="size-3.5 animate-spin text-subtle" aria-hidden /> : undefined}
          actions={!readOnly ? (
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
              <Upload />
              {t('add')}
            </Button>
          ) : undefined}
        />
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('add')}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            if (files.length > 0) onUpload(files)
            event.target.value = ''
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className={cn('rounded-md border border-dashed px-3 py-4 text-center text-xs', over ? 'border-accent text-accent' : 'border-line text-subtle')}>
          {over ? t('dropHere') : `${t('empty')}. ${t('emptyHint', { max: MAX_MB })}`}
        </p>
      ) : (
        <ul className="divide-y divide-line-subtle overflow-hidden rounded-md border border-line">
          {attachments.map((attachment) => {
            const Icon = ICON[attachment.kind]
            return (
              <li key={attachment.id} className="group flex min-w-0 items-center gap-2.5 px-3 py-1.5 transition-colors duration-100 hover:bg-fill">
                {attachment.kind === 'image' ? (
                  <img
                    src={attachment.downloadUrl}
                    alt={t('preview', { name: attachment.filename })}
                    className="size-8 shrink-0 rounded-sm border border-line object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Icon className="size-4 shrink-0 text-subtle" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <a
                    className="block truncate rounded-xs text-sm text-ink underline-offset-2 hover:underline focus-ring"
                    href={attachment.downloadUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={t('openFile', { name: attachment.filename })}
                  >
                    {attachment.filename}
                  </a>
                  <span className="text-2xs text-subtle">
                    {bytes(attachment.sizeBytes)} · {t('byOn', { actor: attachment.actor ?? t('unknownActor'), time: relativeTime(attachment.createdAt) })}
                  </span>
                </div>
                {!readOnly ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="row-actions"
                    aria-label={t('removeTitle', { name: attachment.filename })}
                    onClick={() => setPending(attachment)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => { if (!open) setPending(null) }}
        title={pending ? t('removeTitle', { name: pending.filename }) : ''}
        impact={t('removeImpact')}
        confirmLabel={t('remove')}
        onConfirm={() => {
          if (!pending) return
          onRemove(pending)
          toast.push({ tone: 'ok', duration: 2500, title: t('removed', { name: pending.filename }) })
          setPending(null)
        }}
      />
    </section>
  )
}

/** A pasted screenshot arrives as `image.png` or as nothing; give it a name. */
function renamed(file: File, name: string): File {
  const extension = file.type.split('/')[1] ?? 'png'
  return new File([file], `${name}.${extension}`, { type: file.type })
}
