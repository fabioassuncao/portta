import { describe, expect, it } from 'vitest'
import { columnFor, priorityTone, statusTone } from '@/lib/task-presentation'

describe('task presentation', () => {
  it('tones a priority', () => {
    expect(priorityTone('urgent')).toBe('danger')
    expect(priorityTone('high')).toBe('warn')
    expect(priorityTone('low')).toBe('neutral')
    expect(priorityTone(null)).toBe('neutral')
  })
  it('tones a status', () => {
    expect(statusTone('backlog')).toBe('neutral')
    expect(statusTone('ready')).toBe('outline')
    expect(statusTone('in_progress')).toBe('info')
    expect(statusTone('review')).toBe('accent')
    expect(statusTone('blocked')).toBe('danger')
    expect(statusTone('done')).toBe('ok')
    expect(statusTone(null)).toBe('neutral')
  })
  it('places a task in its column, or the first one', () => {
    const columns = [{ id: 'backlog', status: 'backlog' as const }, { id: 'done', status: 'done' as const }]
    expect(columnFor({ status: 'done' }, columns).id).toBe('done')
    expect(columnFor({ status: null }, columns).id).toBe('backlog')
    expect(columnFor({ status: 'review' }, columns).id).toBe('backlog')
  })
})
