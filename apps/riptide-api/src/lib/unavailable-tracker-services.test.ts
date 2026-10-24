import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getResendWebhookSecret, requireEnvironment } from './environment'
import {
	createStartupIntegrationService,
	createUnavailableJiraService,
	createUnavailableLinearService,
	IntegrationNotConfiguredError,
	registerResendWebhookForStartup,
} from './unavailable-tracker-services'

const environmentKeys = [
	'STAGE',
	'JIRA_CLIENT_ID',
	'JIRA_CLIENT_SECRET',
	'LINEAR_CLIENT_ID',
	'LINEAR_CLIENT_SECRET',
	'RESEND_WEBHOOK_SECRET',
] as const
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))

afterEach(() => {
	for (const key of environmentKeys) {
		const value = savedEnvironment.get(key)
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
	vi.restoreAllMocks()
})

describe('unavailable tracker services', () => {
	it('rejects every Jira and Linear operation with a typed provider-specific error', async () => {
		const jira = createUnavailableJiraService()
		const linear = createUnavailableLinearService()
		const jiraCalls = [
			() => jira.createInstallUrl({ organizationId: 'org', requestedByUserId: 'user', client: 'ui' }),
			() => jira.consumeInstallState('state'),
			() => jira.exchangeCode('org', 'user', 'code'),
			() => jira.getIntegrationStatus('org'),
			() => jira.getIssue('org', 'ENG-1'),
			() => jira.createRemoteLink('org', 'ENG-1', 'url', 'title', 'global-id'),
			() => jira.disconnect('org'),
		]
		const linearCalls = [
			() => linear.createInstallUrl({ organizationId: 'org', requestedByUserId: 'user', client: 'ui' }),
			() => linear.consumeInstallState('state'),
			() => linear.exchangeCode('org', 'user', 'code'),
			() => linear.getIntegrationStatus('org'),
			() => linear.disconnect('org'),
			() => linear.updateIssueStatus('org', 'ENG-1', 'Done'),
			() => linear.createAttachment('org', 'ENG-1', 'url', 'title'),
			() => linear.getIssueMetadata('org', 'ENG-1'),
			() => linear.getIssue('org', 'ENG-1'),
			() => linear.getAccessToken('org'),
		]

		for (const call of jiraCalls) {
			await expect(call()).rejects.toMatchObject({
				name: 'IntegrationNotConfiguredError',
				provider: 'jira',
			})
		}
		for (const call of linearCalls) {
			await expect(call()).rejects.toMatchObject({
				name: 'IntegrationNotConfiguredError',
				provider: 'linear',
			})
		}
		expect(new IntegrationNotConfiguredError('jira').message).toContain('Jira')
	})

	it.each([
		{ clientId: 'jira-id', clientSecret: undefined },
		{ clientId: undefined, clientSecret: 'jira-secret' },
	])('uses unavailable service locally when either credential is missing (%o)', ({ clientId, clientSecret }) => {
		if (clientId) process.env.JIRA_CLIENT_ID = clientId
		else delete process.env.JIRA_CLIENT_ID
		if (clientSecret) process.env.JIRA_CLIENT_SECRET = clientSecret
		else delete process.env.JIRA_CLIENT_SECRET
		const create = vi.fn(() => ({ kind: 'real' }))
		const createUnavailable = vi.fn(() => ({ kind: 'unavailable' }))
		const warn = vi.fn()
		const getCredentials = vi.fn(() => ['jira-id', 'jira-secret'] as const)

		const service = createStartupIntegrationService({
			provider: 'jira',
			stage: 'local',
			getCredentials,
			create,
			createUnavailable,
			warn,
		})

		expect(service).toEqual({ kind: 'unavailable' })
		expect(getCredentials).not.toHaveBeenCalled()
		expect(create).not.toHaveBeenCalled()
		expect(createUnavailable).toHaveBeenCalledOnce()
		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain('jira')
	})

	it('uses the real factory for configured local credentials', () => {
		process.env.LINEAR_CLIENT_ID = 'linear-id'
		process.env.LINEAR_CLIENT_SECRET = 'linear-secret'
		const create = vi.fn((clientId: string, clientSecret: string) => ({ clientId, clientSecret }))
		const getCredentials = vi.fn(() => ['linear-id', 'linear-secret'] as const)
		const warn = vi.fn()

		const service = createStartupIntegrationService({
			provider: 'linear',
			stage: 'local',
			getCredentials,
			create,
			createUnavailable: vi.fn(),
			warn,
		})

		expect(service).toEqual({ clientId: 'linear-id', clientSecret: 'linear-secret' })
		expect(create).toHaveBeenCalledOnce()
		expect(warn).not.toHaveBeenCalled()
	})

	it.each([undefined, 'production'])('keeps non-local missing configuration fail-fast (stage: %s)', (stage) => {
		delete process.env.JIRA_CLIENT_ID
		delete process.env.JIRA_CLIENT_SECRET
		const createUnavailable = vi.fn()
		const warn = vi.fn()

		expect(() =>
			createStartupIntegrationService({
				provider: 'jira',
				stage,
				getCredentials: () => [requireEnvironment('JIRA_CLIENT_ID'), requireEnvironment('JIRA_CLIENT_SECRET')],
				create: vi.fn(),
				createUnavailable,
				warn,
			}),
		).toThrow('Missing required environment variable: JIRA_CLIENT_ID')
		expect(createUnavailable).not.toHaveBeenCalled()
		expect(warn).not.toHaveBeenCalled()
	})
})

describe('Resend webhook startup registration', () => {
	function register(app: Hono, secret: string) {
		app.post('/webhooks/resend', (context) => context.text(`verified:${secret}`))
	}

	it('omits the webhook route when local and the signing secret is missing', async () => {
		process.env.STAGE = 'local'
		delete process.env.RESEND_WEBHOOK_SECRET
		const app = new Hono()
		const getWebhookSecret = vi.fn(getResendWebhookSecret)
		const warn = vi.fn()

		registerResendWebhookForStartup({ app, stage: process.env.STAGE, getWebhookSecret, register, warn })
		expect((await app.request('/webhooks/resend', { method: 'POST' })).status).toBe(404)
		expect(getWebhookSecret).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledOnce()
	})

	it('registers with the configured secret locally', async () => {
		process.env.STAGE = 'local'
		process.env.RESEND_WEBHOOK_SECRET = 'signing-secret'
		const app = new Hono()
		registerResendWebhookForStartup({
			app,
			stage: process.env.STAGE,
			getWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET!,
			register,
			warn: vi.fn(),
		})

		expect((await app.request('/webhooks/resend', { method: 'POST' })).status).toBe(200)
		expect(await (await app.request('/webhooks/resend', { method: 'POST' })).text()).toBe('verified:signing-secret')
	})

	it.each([undefined, 'production'])('fails fast when non-local webhook secret is missing (stage: %s)', (stage) => {
		delete process.env.RESEND_WEBHOOK_SECRET
		const app = new Hono()
		const getWebhookSecret = vi.fn(getResendWebhookSecret)

		expect(() =>
			registerResendWebhookForStartup({ app, stage, getWebhookSecret, register, warn: vi.fn() }),
		).toThrow('Missing required environment variable: RESEND_WEBHOOK_SECRET')
		expect(getWebhookSecret).toHaveBeenCalledOnce()
	})
})
