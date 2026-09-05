'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { Button } from '../ui/button.tsx'
import { MarkdownEditor } from './markdown-editor.tsx'
import { MarkdownView } from './markdown-view.tsx'

export function TaskDescription({ value, disabled, onSave }: {
  value: string | null
  disabled?: boolean
  pending?: boolean
  onSave: (description: string | null) => Promise<unknown> | unknown
}) {
  const { t } = useTranslation('tasks')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaved = useRef(value ?? '')
  const draftRef = useRef(draft)
  const saving = useRef<Promise<boolean>>(Promise.resolve(true))
  draftRef.current = draft

  useEffect(() => {
    if (!editing) {
      setDraft(value ?? '')
      lastSaved.current = value ?? ''
    }
  }, [value])

  const persist = (content: string): Promise<boolean> => {
    if (content === lastSaved.current) return saving.current
    saving.current = saving.current.then(async () => {
      try {
        await onSave(content.trim() === '' ? null : content)
        lastSaved.current = content
        setError(null)
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      }
    })
    return saving.current
  }

  const change = (content: string) => {
    setDraft(content)
    setError(null)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void persist(content) }, 800)
  }

  const finish = async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (await persist(draftRef.current)) setEditing(false)
  }

  useEffect(() => {
    if (!editing) return
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) void finish()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [editing])

  if (editing && !disabled) {
    return <section ref={root} aria-label={t('detail.description')}>
      <MarkdownEditor value={draft} disabled={disabled} autoFocus placeholder={t('detail.addDescription')} onChange={change} onEscape={() => void finish()} />
      <p className={`mt-1 min-h-4 text-xs ${error ? 'text-danger' : 'text-subtle'}`}>{error ?? (draft !== lastSaved.current ? t('save.saving') : t('save.saved'))}</p>
    </section>
  }

  return <section className="group relative min-h-16">
    {!disabled ? (
      <Button variant="ghost" size="xs" onClick={() => setEditing(true)} className="absolute top-0 right-0 row-actions" aria-label={t('detail.edit')}>
        <Pencil />
        {t('detail.edit')}
      </Button>
    ) : null}
    <div onClick={() => { if (!disabled) setEditing(true) }} className="block w-full cursor-text rounded-md text-left outline-none transition-colors duration-100 hover:bg-fill/60">
      {draft ? <MarkdownView source={draft} /> : <p className="py-2 text-sm text-subtle">{t('detail.addDescription')}</p>}
    </div>
  </section>
}
