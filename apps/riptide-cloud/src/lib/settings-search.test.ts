import { describe, expect, it } from 'vitest'

import { settingsSearchSchema } from './settings-search'

describe('settings search', () => {
	it('keeps integration callback results without billing state', () => {
		expect(
			settingsSearchSchema.parse({
				slack_error: 'access_denied',
				github: 'connected',
				billing: 'checkout_synced',
				billing_error: 'checkout_unavailable',
			}),
		).toEqual({ slack_error: 'access_denied', github: 'connected' })
	})

	it('keeps GitHub callback errors', () => {
		expect(settingsSearchSchema.parse({ github_error: 'conflict' })).toEqual({ github_error: 'conflict' })
	})
})
