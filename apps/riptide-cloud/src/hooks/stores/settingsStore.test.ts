import { describe, expect, it } from 'vitest'

import { useSettingsStore } from './settingsStore'

describe('cloud settings', () => {
	it('keeps sync controls session-local without billing preview state', () => {
		expect(useSettingsStore.getState()).not.toHaveProperty('billingPreviewEnabled')
		useSettingsStore.getState().setSyncForceMode('query')
		expect(useSettingsStore.getState().syncForceMode).toBe('query')
		useSettingsStore.getState().open('sync')
		expect(useSettingsStore.getState()).toMatchObject({ isOpen: true, activeTab: 'sync' })
		useSettingsStore.getState().close()
		expect(useSettingsStore.getState().isOpen).toBe(false)
		useSettingsStore.getState().setSyncForceMode('auto')
	})
})
