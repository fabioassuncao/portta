import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { renderWithQuery } from './render.tsx'
import { LogViewer } from '@/components/logs'
import type { LogsResponse, ProjectLogsResponse, ProjectLogSource } from 'portta-contracts'

const response: LogsResponse = {
  containerId: 'c1',
  name: 'alpha-web-1',
  truncated: false,
  lines: [
    { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'listening on 3000' },
    { stream: 'stderr', timestamp: '2026-01-01T10:00:02Z', text: 'connection refused' },
    { stream: 'stdout', timestamp: '2026-01-01T10:00:03Z', text: 'retrying' },
  ],
}

describe('the log viewer', () => {
  it('shows recent lines with their time', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    expect(await screen.findByText('listening on 3000')).toBeInTheDocument()
    expect(screen.getAllByText('10:00:01')).toHaveLength(1)
    expect(screen.getByText('3 lines')).toBeInTheDocument()
  })

  it('filters as you type', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('listening on 3000')

    await userEvent.type(screen.getByLabelText('Filter log lines'), 'refused')
    await waitFor(() => expect(screen.queryByText('listening on 3000')).not.toBeInTheDocument())
    expect(screen.getByText('connection refused')).toBeInTheDocument()
    expect(screen.getByText('1 lines')).toBeInTheDocument()
  })

  it('says when a filter matches nothing', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('retrying')
    await userEvent.type(screen.getByLabelText('Filter log lines'), 'zzz')
    expect(await screen.findByText('No line matches the filter')).toBeInTheDocument()
  })

  it('copies what is on screen, not what was filtered out', async () => {
    renderWithQuery(<LogViewer queryKey={['x']} load={() => Promise.resolve(response)} />)
    await screen.findByText('retrying')

    await userEvent.type(screen.getByLabelText('Filter log lines'), 'retry')
    await userEvent.click(screen.getByRole('button', { name: 'Copy log' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('retrying')
  })

  it('asks for more lines when told to', async () => {
    const load = vi.fn().mockResolvedValue(response)
    renderWithQuery(<LogViewer queryKey={['x']} load={load} />)
    await screen.findByText('retrying')
    expect(load).toHaveBeenCalledWith(200)

    await userEvent.selectOptions(screen.getByLabelText('Number of lines'), '1000')
    await waitFor(() => expect(load).toHaveBeenCalledWith(1000))
  })

  it('reports a failure instead of showing an empty pane', async () => {
    renderWithQuery(
      <LogViewer queryKey={['x']} load={() => Promise.reject(new Error('could not read logs'))} />,
    )
    expect(await screen.findByText('could not read logs')).toBeInTheDocument()
  })

  it('says nothing has been logged yet', async () => {
    renderWithQuery(
      <LogViewer queryKey={['x']} load={() => Promise.resolve({ ...response, lines: [] })} />,
    )
    expect(await screen.findByText('No output yet')).toBeInTheDocument()
  })
})

const SOURCES: ProjectLogSource[] = [
  { containerId: 'a-web', service: 'web', name: 'alpha-web-1', state: 'running', lineCount: 2, truncated: false, error: null },
  { containerId: 'a-api', service: 'api', name: 'alpha-api-1', state: 'running', lineCount: 1, truncated: false, error: null },
]

const projectResponse: ProjectLogsResponse = {
  project: 'alpha',
  sources: SOURCES,
  truncated: false,
  ordered: true,
  lines: [
    { stream: 'stdout', timestamp: '2026-01-01T10:00:01Z', text: 'web up', service: 'web' },
    { stream: 'stdout', timestamp: '2026-01-01T10:00:02Z', text: 'api up', service: 'api' },
  ],
}

describe('the log viewer across a project', () => {
  it('labels every line with the service that produced it', async () => {
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(projectResponse)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    await screen.findByText('web up')
    expect(screen.getByText(/^web\s+\|$/)).toBeInTheDocument()
    expect(screen.getByText(/^api\s+\|$/)).toBeInTheDocument()
  })

  it('narrows to one service through the selector', async () => {
    const onSelectService = vi.fn()
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(projectResponse)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={onSelectService}
      />,
    )
    await screen.findByText('web up')
    await userEvent.selectOptions(screen.getByLabelText('Service'), 'api')
    expect(onSelectService).toHaveBeenCalledWith('api')
  })

  it('reports a source that failed beside the lines that arrived', async () => {
    const withFailure: ProjectLogsResponse = {
      ...projectResponse,
      sources: [
        SOURCES[0]!,
        { ...SOURCES[1]!, lineCount: 0, error: 'could not read logs: container is gone' },
      ],
      lines: [projectResponse.lines[0]!],
    }
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(withFailure)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    expect(await screen.findByText('web up')).toBeInTheDocument()
    expect(screen.getByText('could not read logs: container is gone')).toBeInTheDocument()
  })

  it('marks a stopped source without hiding what it logged', async () => {
    const stopped: ProjectLogsResponse = {
      ...projectResponse,
      sources: [SOURCES[0]!, { ...SOURCES[1]!, state: 'exited' }],
    }
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(stopped)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    await screen.findByText('api up')
    expect(within(screen.getByRole('status', { name: 'Log sources' })).getByText('exited')).toBeInTheDocument()
  })

  it('says ordering is approximate when a source logs without timestamps', async () => {
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve({ ...projectResponse, ordered: false })}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    expect(await screen.findByText(/ordering between services is approximate/)).toBeInTheDocument()
  })

  it('copies the service name alongside each line', async () => {
    renderWithQuery(
      <LogViewer
        queryKey={['p']}
        load={() => Promise.resolve(projectResponse)}
        sources={SOURCES}
        showOrigin
        selectedService={null}
        onSelectService={() => {}}
      />,
    )
    await screen.findByText('web up')
    await userEvent.click(screen.getByRole('button', { name: 'Copy log' }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('web | web up\napi | api up')
  })
})
