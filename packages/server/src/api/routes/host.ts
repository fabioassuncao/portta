import { Hono } from 'hono'
import type { AppDeps } from '../../deps.ts'
import { MetricsCurrent, MetricsHistory } from 'portta-contracts'
import { historyWindowSeconds, readCurrentMetrics, readMetricsHistory } from '../../services/metrics.ts'
import { documentRoute } from '../openapi.ts'

export function hostRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/metrics/current', documentRoute({
    tag: 'Status',
    operationId: 'getMetricsCurrent', permission: 'metrics:read',
    summary: 'Get the latest host and project metrics snapshot',
    response: MetricsCurrent,
    description:
      'Reads state/metrics/current.json written by the CLI collector. The panel never collects. A missing file is an empty object, never an error.',
    errors: [500],
  }), (c) => c.json(readCurrentMetrics(deps.config)))

  app.get('/metrics/history', documentRoute({
    tag: 'Status',
    operationId: 'getMetricsHistory', permission: 'metrics:read',
    summary: 'Get the short host metrics history',
    response: MetricsHistory,
    description: 'Reads state/metrics/history.jsonl. window is 15m, 30m or 60m.',
    errors: [500],
    parameters: [{
      name: 'window',
      in: 'query',
      required: false,
      schema: { type: 'string', enum: ['15m', '30m', '60m'] },
    }],
  }), (c) => {
    const windowSeconds = historyWindowSeconds(c.req.query('window'))
    return c.json(readMetricsHistory(deps.config, windowSeconds))
  })

  return app
}
