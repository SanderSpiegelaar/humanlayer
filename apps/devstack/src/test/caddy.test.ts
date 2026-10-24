import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureCaddy, parseCaddyProcesses, renderCaddyConfig } from '../lib/caddy'
import { REGISTRY_VERSION, type DevstackRegistry, type StackRecord } from '../lib/registry'

const hostBackends = [
	['ui.test.localhost', '127.0.0.1:4100'],
	['cloud.test.localhost', '127.0.0.1:4101'],
	['api.test.localhost', '127.0.0.1:4102'],
	['sync.test.localhost', '127.0.0.1:4103'],
	['docs.test.localhost', '127.0.0.1:4104'],
	['admin-api.test.localhost', '127.0.0.1:4105'],
	['admin.test.localhost', '127.0.0.1:4106'],
] as const

function registry(): DevstackRegistry {
	const stack = {
		id: 'test',
		routes: Object.fromEntries(
			hostBackends.map(([hostname], index) => [
				['ui', 'cloud', 'api', 'sync', 'docs', 'adminApi', 'adminUi'][index],
				`https://${hostname}`,
			]),
		),
		ports: {
			ui: 4100,
			cloud: 4101,
			api: 4102,
			electricProxy: 4103,
			docs: 4104,
			adminApi: 4105,
			adminUi: 4106,
		},
		api: { backend: '127.0.0.1:4102' },
		electric: { proxyBackend: '127.0.0.1:4103' },
	} as unknown as StackRecord
	return { version: REGISTRY_VERSION, stacks: { test: stack } }
}

function activeConfig(entries: ReadonlyArray<readonly [string, string]> = hostBackends): unknown {
	return {
		apps: {
			http: {
				servers: {
					devstack: {
						routes: [
							{ match: [{ host: ['devstack.localhost'] }], handle: [{ handler: 'static_response' }] },
							...entries.map(([hostname, backend]) => ({
								match: [{ host: [hostname] }],
								handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: backend }] }],
							})),
						],
					},
				},
			},
		},
	}
}

describe.skipIf(Boolean(process.env.CI))('ensureCaddy', () => {
	let directory: string | undefined

	afterEach(async () => {
		if (directory) await rm(directory, { recursive: true, force: true })
		directory = undefined
	})

	async function registryPath(): Promise<string> {
		directory = await mkdtemp(join(tmpdir(), 'devstack-caddy-test-'))
		const path = join(directory, 'registry.json')
		await writeFile(path, JSON.stringify(registry()))
		return path
	}

	it('forces reload and accepts every HTTP response status from HTTPS probes', async () => {
		const path = await registryPath()
		const reload = vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' })
		const fetchEndpoint = vi.fn().mockResolvedValue(Response.json(activeConfig()))
		const probeRoute = vi.fn().mockResolvedValue(undefined)
		const result = await ensureCaddy(path, {
			runtime: {
				status: vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' }),
				reload,
				fetch: fetchEndpoint as unknown as typeof fetch,
				probeRoute,
			},
		})

		expect(result.plannedAction).toBe('reload')
		expect(reload).toHaveBeenCalledOnce()
		expect(fetchEndpoint).toHaveBeenCalledWith('http://localhost:2019/config/')
		expect(probeRoute).toHaveBeenCalledWith('ui.test.localhost')
		expect(probeRoute).toHaveBeenCalledWith('devstack.localhost')
	})

	it('verifies startup without stale routes that have no backend port', async () => {
		const path = await registryPath()
		const storedRegistry = registry()
		const first = storedRegistry.stacks.test!
		storedRegistry.stacks.test = {
			...first,
			routes: { ...first.routes, s3: 'https://s3.main.localhost' },
			ports: { ...first.ports, rustfsApi: undefined },
		} as unknown as StackRecord
		await writeFile(path, JSON.stringify(storedRegistry))
		const start = vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' })
		const probeRoute = vi.fn().mockResolvedValue(undefined)

		await expect(
			ensureCaddy(path, {
				runtime: {
					status: vi.fn().mockResolvedValue({ running: false, pid: null, configPath: 'config' }),
					start,
					fetch: vi.fn().mockResolvedValue(Response.json(activeConfig())) as unknown as typeof fetch,
					probeRoute,
				},
			}),
		).resolves.toMatchObject({ plannedAction: 'start', running: true })

		expect(start).toHaveBeenCalledOnce()
		expect(probeRoute).toHaveBeenCalledWith('ui.test.localhost')
		expect(probeRoute).toHaveBeenCalledWith('api.test.localhost')
		expect(probeRoute).not.toHaveBeenCalledWith('s3.main.localhost')
	})

	it('restarts after failed convergence and verifies the replacement', async () => {
		const path = await registryPath()
		const restart = vi.fn().mockResolvedValue({ running: true, pid: 13, configPath: 'config' })
		const adminConfigs = [activeConfig(hostBackends.slice(0, 6)), activeConfig()]
		const fetchEndpoint = vi.fn(async (url: string) => {
			if (url === 'http://localhost:2019/config/') return Response.json(adminConfigs.shift() ?? activeConfig())
			return new Response('', { status: 502 })
		})

		await ensureCaddy(path, {
			verification: { timeoutMs: 0, retryMs: 0 },
			runtime: {
				status: vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' }),
				reload: vi.fn().mockRejectedValue(new Error('reload failed')),
				restart,
				fetch: fetchEndpoint as unknown as typeof fetch,
				probeRoute: vi.fn().mockResolvedValue(undefined),
			},
		})

		expect(restart).toHaveBeenCalledOnce()
	})

	it('fails clearly when restart verification does not converge', async () => {
		const path = await registryPath()
		await expect(
			ensureCaddy(path, {
				verification: { timeoutMs: 0, retryMs: 0 },
				runtime: {
					status: vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' }),
					reload: vi.fn().mockResolvedValue({ running: true, pid: 12, configPath: 'config' }),
					restart: vi.fn().mockResolvedValue({ running: true, pid: 13, configPath: 'config' }),
					fetch: vi.fn().mockResolvedValue(Response.json(activeConfig([]))) as unknown as typeof fetch,
					probeRoute: vi.fn().mockResolvedValue(undefined),
				},
			}),
		).rejects.toThrow('Caddy restart did not converge: Caddy verification did not converge')
	})
})

describe.skipIf(Boolean(process.env.CI))('renderCaddyConfig', () => {
	it('serves a static index with app and cloud links for every stack', () => {
		const config = renderCaddyConfig(Object.values(registry().stacks))

		expect(config).toContain('https://devstack.localhost {')
		expect(config).toContain('<h1>Dev<span>stacks</span></h1>')
		expect(config).toContain('<strong>1</strong><span>registered stack</span>')
		expect(config).toContain('data-health-url="https://api.test.localhost/health"')
		expect(config).toContain('data-health-state="checking"')
		expect(config).toContain('data-state="checking"')
		expect(config).toContain("document.querySelectorAll('[data-health-url]')")
		expect(config).toContain('setTimeout(() => controller.abort(), 2000)')
		expect(config).toContain("response.ok ? 'online' : 'offline'")
		expect(config).toContain('article[data-health-state="online"] { order: -1; }')
		expect(config).toContain('article[data-health-state="offline"] nav { display: none; }')
		expect(config).toContain('card.dataset.healthState = state')
		expect(config).toContain("card.dataset.healthState = 'offline'")
		expect(config).toContain('href="https://ui.test.localhost"')
		expect(config).toContain('href="https://cloud.test.localhost"')
		expect(config).toContain('target="_blank" rel="noopener noreferrer"')
		expect(config).toContain('aria-label="test destinations"')
		expect(config).toContain('data-theme="poimandres-vscode"')
		expect(config).toContain('<title>devstk</title>')
		expect(config).toContain("fill='%2310120f'")
		expect(config).toContain("fill='%23d6ff38'")
	})

	it('serves an empty state when no stacks are registered', () => {
		const config = renderCaddyConfig([])

		expect(config).toContain('No devstacks are currently registered.')
		expect(config).toContain('<strong>0</strong><span>registered stacks</span>')
		expect(config).toContain('Run devstack start to bring one online.')
		expect(config).not.toContain('data-health-url=')
	})

	it('sorts cards and escapes health URLs at the markup boundary', () => {
		const first = registry().stacks.test!
		const config = renderCaddyConfig([
			{ ...first, id: 'z-stack', routes: { ...first.routes, api: 'https://api.z.localhost?x="unsafe"' } },
			{ ...first, id: 'a-stack', routes: { ...first.routes, api: 'https://api.a.localhost' } },
		])

		expect(config.indexOf('<code>a-stack</code>')).toBeLessThan(config.indexOf('<code>z-stack</code>'))
		expect(config).toContain('data-health-url="https://api.z.localhost?x=&quot;unsafe&quot;/health"')
	})

	it('omits routes without valid ports while retaining routes from other stacks', () => {
		const first = registry().stacks.test!
		const staleStack = {
			...first,
			id: 'legacy',
			routes: { ...first.routes, s3: 'https://s3.legacy.localhost' },
			ports: { ...first.ports, rustfsApi: undefined },
		} as unknown as StackRecord
		const freshStack = {
			...first,
			id: 'fresh',
			routes: { ...first.routes, s3: 'https://s3.fresh.localhost' },
			ports: { ...first.ports, rustfsApi: 4107 },
		} as StackRecord

		const config = renderCaddyConfig([staleStack, freshStack])

		expect(config).toContain('https://ui.test.localhost')
		expect(config).not.toContain('s3.legacy.localhost {')
		expect(config).toContain('https://s3.fresh.localhost {')
		expect(config).toContain('reverse_proxy 127.0.0.1:4107')
		expect(config).not.toContain('127.0.0.1:undefined')
	})

	it.each([undefined, 0, -1, 65536, 1.5])('omits routes with invalid fallback port %s', (port) => {
		const first = registry().stacks.test!
		const stack = {
			...first,
			routes: { ...first.routes, s3: 'https://s3.invalid.localhost' },
			ports: { ...first.ports, rustfsApi: port },
		} as unknown as StackRecord

		const config = renderCaddyConfig([stack])

		expect(config).not.toContain('https://s3.invalid.localhost {')
		expect(config).toContain('https://ui.test.localhost {')
		expect(config).not.toContain('127.0.0.1:undefined')
	})
})

describe.skipIf(Boolean(process.env.CI))('parseCaddyProcesses', () => {
	it('reports competing Caddy processes but excludes the managed PID', () => {
		const conflicts = parseCaddyProcesses(
			'  101 caddy run --config /tmp/generated\n  202 /opt/homebrew/bin/caddy run --config Caddyfile\n  303 bun run dev\n',
			101,
		)

		expect(conflicts).toEqual([{ pid: 202, command: '/opt/homebrew/bin/caddy run --config Caddyfile' }])
	})
})
