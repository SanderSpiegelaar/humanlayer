import type { IJiraService } from './jira-service'
import type { ILinearService } from './linear-service'

export type TrackerProvider = 'jira' | 'linear'

export class IntegrationNotConfiguredError extends Error {
	constructor(public readonly provider: TrackerProvider) {
		super(`${provider === 'jira' ? 'Jira' : 'Linear'} integration is not configured`)
		this.name = 'IntegrationNotConfiguredError'
	}
}

export function createUnavailableJiraService(): IJiraService {
	const unavailable = (): never => {
		throw new IntegrationNotConfiguredError('jira')
	}
	return {
		createInstallUrl: async () => unavailable(),
		consumeInstallState: async () => unavailable(),
		exchangeCode: async () => unavailable(),
		getIntegrationStatus: async () => unavailable(),
		getIssue: async () => unavailable(),
		createRemoteLink: async () => unavailable(),
		disconnect: async () => unavailable(),
	}
}

export function createUnavailableLinearService(): ILinearService {
	const unavailable = (): never => {
		throw new IntegrationNotConfiguredError('linear')
	}
	return {
		createInstallUrl: async () => unavailable(),
		consumeInstallState: async () => unavailable(),
		exchangeCode: async () => unavailable(),
		getIntegrationStatus: async () => unavailable(),
		disconnect: async () => unavailable(),
		updateIssueStatus: async () => unavailable(),
		createAttachment: async () => unavailable(),
		getIssueMetadata: async () => unavailable(),
		getIssue: async () => unavailable(),
		getAccessToken: async () => unavailable(),
	}
}

export function createStartupIntegrationService<T>(options: {
	provider: TrackerProvider
	stage: string | undefined
	getCredentials: () => readonly [string, string]
	create: (clientId: string, clientSecret: string) => T
	createUnavailable: () => T
	warn: (message: string) => void
}): T {
	if (options.stage === 'local') {
		const [clientId, clientSecret] = [
			process.env[`${options.provider.toUpperCase()}_CLIENT_ID`],
			process.env[`${options.provider.toUpperCase()}_CLIENT_SECRET`],
		]
		if (!clientId || !clientSecret) {
			options.warn(`${options.provider} integration unavailable: client credentials are not configured`)
			return options.createUnavailable()
		}
	}

	const [clientId, clientSecret] = options.getCredentials()
	return options.create(clientId, clientSecret)
}

export function registerResendWebhookForStartup<TApp, TSecret>(options: {
	app: TApp
	stage: string | undefined
	getWebhookSecret: () => TSecret
	register: (app: TApp, secret: TSecret) => void
	warn: (message: string) => void
}): void {
	if (options.stage === 'local' && !process.env.RESEND_WEBHOOK_SECRET) {
		options.warn('Resend webhook unavailable: webhook secret is not configured')
		return
	}
	options.register(options.app, options.getWebhookSecret())
}
