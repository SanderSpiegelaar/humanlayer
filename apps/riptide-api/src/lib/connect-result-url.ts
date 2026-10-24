import type { RiptideClient } from '@humanlayer/riptide-api-contract/types/client'

import { requireEnvironment } from './environment'

export type ConnectResultProvider = 'linear' | 'jira'

export type ConnectResultStatus = 'connected' | 'access_denied' | 'auth_failed' | 'invalid_link' | 'unavailable'

export function buildConnectResultUrl(input: {
	provider: ConnectResultProvider
	client: RiptideClient
	status: ConnectResultStatus
}): string {
	const url = new URL(`/connect/${input.provider}`, requireEnvironment('CLOUD_ORIGIN', 'http://localhost:5174'))
	url.searchParams.set('status', input.status)
	url.searchParams.set('client', input.client)
	return url.toString()
}
