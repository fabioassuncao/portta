import { describe, expect, it } from 'vitest'
import { normalizeImageRepo, resolveServiceTech } from '../src/services/tech.ts'

describe('normalizeImageRepo', () => {
  it('strips tags, digests and registries', () => {
    expect(normalizeImageRepo('postgres:18.6-alpine')).toBe('postgres')
    expect(normalizeImageRepo('docker.io/library/redis:8.10.1-alpine')).toBe('redis')
    expect(normalizeImageRepo('ghcr.io/axllent/mailpit:v1.31.0')).toBe('mailpit')
    expect(normalizeImageRepo('rustfs/rustfs:1.0.0-rc.4')).toBe('rustfs')
    expect(normalizeImageRepo('nginx@sha256:abc')).toBe('nginx')
    expect(normalizeImageRepo('public.ecr.aws/docker/library/mysql:8.4.7')).toBe('mysql')
  })
})

describe('resolveServiceTech', () => {
  it('recognises common images by substring', () => {
    expect(resolveServiceTech({ image: 'postgres:18.6-alpine' }).id).toBe('postgres')
    expect(resolveServiceTech({ image: 'mysql:8.4.7' }).id).toBe('mysql')
    expect(resolveServiceTech({ image: 'redis:8.10.1-alpine' }).id).toBe('redis')
    expect(resolveServiceTech({ image: 'nginx:1.31.4-alpine' }).id).toBe('nginx')
    expect(resolveServiceTech({ image: 'axllent/mailpit:v1.31.0' }).id).toBe('mailpit')
    expect(resolveServiceTech({ image: 'rustfs/rustfs:1.0.0-rc.4' }).id).toBe('s3')
    expect(resolveServiceTech({ image: 'minio/minio:RELEASE.2024' }).id).toBe('s3')
    expect(resolveServiceTech({ image: 'node:24.20.0-alpine' }).id).toBe('node')
    expect(resolveServiceTech({ image: 'traefik:v3.7.12' }).id).toBe('traefik')
    expect(resolveServiceTech({ image: 'python:3.13-alpine' }).id).toBe('python')
  })

  it('falls back to the Compose service name when the image is opaque', () => {
    expect(resolveServiceTech({ image: 'custom-app:1', service: 'postgres' }).id).toBe('postgres')
    expect(resolveServiceTech({ image: 'acme/shop:dev', service: 'mailpit' }).id).toBe('mailpit')
    expect(resolveServiceTech({ image: 'acme/shop:dev', service: 'rustfs' }).id).toBe('s3')
  })

  it('uses a generic Docker identity when nothing matches', () => {
    expect(resolveServiceTech({ image: 'traefik/whoami:v1.12.0' })).toEqual({
      id: 'docker',
      label: 'Container',
    })
    expect(resolveServiceTech({ image: 'custom-app:1', service: 'web' }).id).toBe('docker')
    expect(resolveServiceTech({ image: '' }).id).toBe('docker')
  })

  it('honours the OCI title label as a last resort before the fallback', () => {
    expect(
      resolveServiceTech({
        image: 'company/db:1',
        labels: { 'org.opencontainers.image.title': 'PostgreSQL' },
      }).id,
    ).toBe('postgres')
  })
})
