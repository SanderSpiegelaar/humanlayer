import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { renderCaddyConfig } from '../lib/caddy'
import { createComposeTeardownCommands } from '../lib/compose'
import { renderStackEnvLines } from '../lib/env-block'
import {
	createApiManifest,
	createElectricManifest,
	createRustfsManifest,
	createPostgresManifest,
	createRivetManifest,
} from '../lib/manifest'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'

const execFileAsync = promisify(execFile)

function createStack(): StackRecord {
	const id = 'rustfs-a'
	const composeProject = `riptide-${id}`
	const routes = createStackRoutes(id)
	const ports = {
		ui: 45000,
		cloud: 45001,
		api: 45002,
		electricProxy: 45003,
		docs: 45004,
		adminApi: 45005,
		adminUi: 45006,
		postgres: 45007,
		electric: 45008,
		rivetEngine: 45009,
		rivetServices: 45010,
		rustfsApi: 45011,
		rustfsConsole: 45012,
		tanstackDevtools: 45013,
		testPostgres: 45014,
		testElectric: 45015,
		testRivetEngine: 45016,
		testRivetServices: 45017,
	}
	return {
		id,
		displayName: id,
		worktreePath: '/tmp/rustfs-a',
		composeProject,
		tauriSuffix: id,
		ports,
		routes,
		postgres: createPostgresManifest({ composeProject, postgresPort: ports.postgres }),
		api: createApiManifest(ports.api, routes.api),
		electric: createElectricManifest({
			stackId: id,
			electricPort: ports.electric,
			electricProxyPort: ports.electricProxy,
		}),
		rivet: createRivetManifest({
			composeProject,
			enginePort: ports.rivetEngine,
			servicesPort: ports.rivetServices,
		}),
		rustfs: createRustfsManifest({ composeProject, apiPort: ports.rustfsApi, consolePort: ports.rustfsConsole }),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe('RustFS stack isolation', () => {
	it('projects stack ports, storage, bucket, endpoint, and credentials', () => {
		const stack = createStack()
		const lines = renderStackEnvLines(stack, '/tmp/registry.json')
		expect(lines).toContain('DEVSTACK_RUSTFS_API_PORT=45011')
		expect(lines).toContain('DEVSTACK_RUSTFS_CONSOLE_PORT=45012')
		expect(lines).toContain('DEVSTACK_RUSTFS_VOLUME=riptide-rustfs-a-rustfs')
		expect(lines).toContain('S3_ARTIFACTS_ENDPOINT=https://s3.rustfs-a.localhost')
		expect(lines).toContain('S3_ARTIFACTS_BUCKET=riptide-artifacts')
		expect(lines).toContain('S3_ACCESS_KEY_ID=rustfsadmin')
		expect(lines).toContain('S3_SECRET_ACCESS_KEY=rustfsadmin')
		expect(renderCaddyConfig([stack])).toContain('reverse_proxy 127.0.0.1:45011')
	})

	it('preserves an existing RustFS bucket, credentials, and volume during projection', () => {
		const manifest = createRustfsManifest({
			composeProject: 'riptide-existing',
			apiPort: 9000,
			consolePort: 9001,
			volume: 'existing-rustfs-data',
			bucket: 'existing-artifacts',
			accessKeyId: 'existing-access-key',
			secretAccessKey: 'existing-secret-key',
		})
		expect(manifest).toMatchObject({
			volume: 'existing-rustfs-data',
			bucket: 'existing-artifacts',
			accessKeyId: 'existing-access-key',
			secretAccessKey: 'existing-secret-key',
		})
	})

	it('parameterizes Compose RustFS resources without reusing MinIO storage', async () => {
		const compose = Bun.YAML.parse(await readFile(resolve(process.cwd(), '../../docker-compose.yaml'), 'utf8'))
		expect(compose).toHaveProperty('services.rustfs.image', 'docker.io/rustfs/rustfs:1.0.3')
		expect(compose).toHaveProperty('services.rustfs.ports', [
			'${DEVSTACK_RUSTFS_API_PORT:-9000}:9000',
			'${DEVSTACK_RUSTFS_CONSOLE_PORT:-9001}:9001',
		])
		expect(compose).toHaveProperty('services.rustfs.environment.RUSTFS_CORS_ALLOWED_ORIGINS', '*')
		expect(compose).toHaveProperty(
			'services.rustfs-setup.environment.S3_ARTIFACTS_BUCKET',
			'${S3_ARTIFACTS_BUCKET:-riptide-artifacts}',
		)
		expect(compose).toHaveProperty(
			'volumes.rustfs_data.name',
			'${DEVSTACK_RUSTFS_VOLUME:-electric_quickstart_rustfs_data}',
		)
		expect(compose).toHaveProperty(
			'services.rustfs.healthcheck.test',
			expect.arrayContaining([expect.stringContaining('http://127.0.0.1:9000/health')]),
		)
		expect(compose).not.toHaveProperty('services.minio')
		expect(compose).not.toHaveProperty('services.minio-setup')
		expect(compose).not.toHaveProperty('volumes.minio_data')
	})

	it('tears down only the selected RustFS volume', () => {
		const commands = createComposeTeardownCommands(createStack())
		expect(commands[0]?.args).toContain('riptide-rustfs-a')
		expect(commands.find((command) => command.label === 'volumes')?.args).toContain('riptide-rustfs-a-rustfs')
	})
})

describe('RustFS bucket initialization', () => {
	async function runSetup(input: { headStatus: number; createStatus?: number; bucket?: string }) {
		const directory = await mkdtemp(join(tmpdir(), 'rustfs-setup-'))
		const logPath = join(directory, 'calls.log')
		try {
			const awsPath = join(directory, 'aws')
			await writeFile(
				awsPath,
				`#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
case "$4" in
  head-bucket) exit "$HEAD_STATUS" ;;
  create-bucket) exit "$CREATE_STATUS" ;;
  *) exit 99 ;;
esac
`,
			)
			await chmod(awsPath, 0o755)
			const execution = execFileAsync('/bin/sh', [resolve(process.cwd(), '../../docker/rustfs/init-bucket.sh')], {
				env: {
					PATH: directory,
					CALL_LOG: logPath,
					HEAD_STATUS: String(input.headStatus),
					CREATE_STATUS: String(input.createStatus ?? 0),
					S3_ARTIFACTS_BUCKET: input.bucket ?? 'custom-artifacts',
				},
			})
			let exitCode = 0
			try {
				await execution
			} catch (error) {
				if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'number') throw error
				exitCode = error.code
			}
			const calls = await readFile(logPath, 'utf8').catch((error: unknown) => {
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
				throw error
			})
			return { exitCode, calls: calls.trim().split('\n').filter(Boolean) }
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	it('creates a missing configured bucket', async () => {
		expect(await runSetup({ headStatus: 1 })).toEqual({
			exitCode: 0,
			calls: [
				'--endpoint-url http://rustfs:9000 s3api head-bucket --bucket custom-artifacts',
				'--endpoint-url http://rustfs:9000 s3api create-bucket --bucket custom-artifacts',
			],
		})
	})

	it('does not recreate an existing bucket', async () => {
		expect(await runSetup({ headStatus: 0 })).toEqual({
			exitCode: 0,
			calls: ['--endpoint-url http://rustfs:9000 s3api head-bucket --bucket custom-artifacts'],
		})
	})

	it('fails when bucket creation fails', async () => {
		expect((await runSetup({ headStatus: 1, createStatus: 17 })).exitCode).toBe(17)
	})

	it('rejects a missing bucket before contacting S3', async () => {
		const result = await runSetup({ headStatus: 0, bucket: '' })
		expect(result.exitCode).not.toBe(0)
		expect(result.calls).toEqual([])
	})
})
