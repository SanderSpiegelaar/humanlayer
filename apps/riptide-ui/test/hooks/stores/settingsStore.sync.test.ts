import { beforeEach, describe, expect, test } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

/**
 * Tests for `applyServerSettings`, the reconciler that folds the polled server
 * settings response into the store.
 *
 * Two behaviors matter and are easy to regress:
 * - The mutation guard: within MUTATION_GUARD_MS (5s) of a local mutation, the
 *   server-synced *user* settings must NOT clobber the optimistic local value.
 * - Org / effective settings and integration flags are authoritative and are
 *   *always* applied, regardless of the guard.
 */

type ServerSettingsResponse = Parameters<ReturnType<typeof useSettingsStore.getState>['applyServerSettings']>[0]

test('fresh settings enable research and multiplayer without selecting Haiku or collection', () => {
	const fresh = useSettingsStore.getInitialState()
	expect(fresh.experimentalSubagentsEnabled).toBe(true)
	expect(fresh.haikuResearchSubagentsEnabled).toBe(false)
	expect(fresh.projectsV2Enabled).toBe(true)
	expect(fresh.effectiveSettings).toEqual({
		experimentalSubagentsEnabled: true,
		haikuResearchSubagentsEnabled: false,
	})
	expect(fresh.orgSettings).toMatchObject({
		experimentalSubagentsEnabled: true,
		haikuResearchSubagentsEnabled: true,
		multiplayerPromptingEnabled: true,
		jiraIntegrationEnabled: false,
		linearIntegrationEnabled: false,
		commitTrackingEnabled: false,
	})
})

function makeResponse(overrides?: {
	userSettings?: Partial<ServerSettingsResponse['userSettings']>
	effective?: Partial<ServerSettingsResponse['effective']>
	orgSettings?: Partial<ServerSettingsResponse['orgSettings']>
	jiraNeedsReauth?: boolean
	jiraSiteUrl?: string | null
	linearNeedsReauth?: boolean
}): ServerSettingsResponse {
	return {
		effective: {
			experimentalSubagentsEnabled: true,
			haikuResearchSubagentsEnabled: true,
			jiraEnabled: true,
			linearEnabled: true,
			...overrides?.effective,
		},
		userSettings: {
			theme: 'dracula',
			experimentalSubagentsEnabled: true,
			haikuResearchSubagentsEnabled: true,
			defaultModel: 'sonnet',
			defaultAgent: 'codelayer',
			preferBatchQueueDelivery: false,
			showTaskPhaseLabels: true,
			projectsV2Enabled: true,
			onboardingDismissedAt: null,
			experiments: { githubPrPanelEnabled: true },
			firstTaskCompletedAt: 1_700_000_000_100,
			firstStructuredWorkflowCompletedAt: 1_700_000_000_200,
			firstInboundCommentReceivedAt: 1_700_000_000_300,
			...overrides?.userSettings,
		},
		orgSettings: {
			experimentalSubagentsEnabled: true,
			haikuResearchSubagentsEnabled: true,
			jiraIntegrationEnabled: true,
			linearIntegrationEnabled: true,
			enableCreatingPubliclyShareableLinks: false,
			commitTrackingEnabled: true,
			multiplayerPromptingEnabled: true,
			...overrides?.orgSettings,
		},
		jiraNeedsReauth: overrides?.jiraNeedsReauth ?? false,
		jiraSiteUrl: overrides?.jiraSiteUrl ?? null,
		...(overrides?.linearNeedsReauth !== undefined ? { linearNeedsReauth: overrides.linearNeedsReauth } : {}),
	}
}

describe('settingsStore applyServerSettings', () => {
	const scope = 'user-1:org-1'

	test('syncs the existing dismissal preference, guards optimistic changes, and accepts reopening', () => {
		useSettingsStore.setState({ _lastMutationAt: 0 })
		useSettingsStore
			.getState()
			.applyServerSettings(makeResponse({ userSettings: { onboardingDismissedAt: 123 } }), scope)
		expect(useSettingsStore.getState().onboardingDismissedAt).toBe(123)
		useSettingsStore.getState().markMutationInFlight()
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)
		expect(useSettingsStore.getState().onboardingDismissedAt).toBe(123)
		useSettingsStore.setState({ _lastMutationAt: 0 })
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)
		expect(useSettingsStore.getState().onboardingDismissedAt).toBeNull()
	})
	beforeEach(() => {
		// Reset the fields these tests read/write to a known baseline. The store is
		// a persisted singleton, so we set state explicitly rather than relying on
		// the (possibly migrated) initial values.
		useSettingsStore.setState({
			_lastMutationAt: 0,
			_serverSettingsRequestedScope: scope,
			_serverSettingsAppliedScope: null,
			theme: 'catppuccin',
			streamingRenderingEnabled: true,
			experimentalSubagentsEnabled: false,
			haikuResearchSubagentsEnabled: false,
			defaultModel: 'opus',
			defaultClaudeCodeModel: 'opus',
			defaultAgent: 'claude',
			preferBatchQueueDelivery: true,
			showTaskPhaseLabels: false,
			projectsV2Enabled: false,
			onboardingDismissedAt: null,
			githubPrPanelEnabled: false,
			roundedCornersEnabled: true,
			firstTaskCompletedAt: null,
			firstStructuredWorkflowCompletedAt: null,
			firstInboundCommentReceivedAt: null,
			jiraEnabled: false,
			linearEnabled: false,
			jiraNeedsReauth: false,
			jiraSiteUrl: null,
			linearNeedsReauth: false,
			effectiveSettings: {
				experimentalSubagentsEnabled: false,
				haikuResearchSubagentsEnabled: false,
			},
			orgSettings: {
				experimentalSubagentsEnabled: false,
				haikuResearchSubagentsEnabled: false,
				jiraIntegrationEnabled: false,
				linearIntegrationEnabled: false,
				enableCreatingPubliclyShareableLinks: true,
				commitTrackingEnabled: false,
				multiplayerPromptingEnabled: false,
			},
		})
	})

	test('applies server-synced user settings when no recent mutation', () => {
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)

		const state = useSettingsStore.getState()
		expect(state.theme).toBe('dracula')
		expect(state.experimentalSubagentsEnabled).toBe(true)
		expect(state.haikuResearchSubagentsEnabled).toBe(true)
		expect(state.defaultModel).toBe('sonnet')
		expect(state.defaultClaudeCodeModel).toBe('sonnet')
		expect(state.defaultAgent).toBe('codelayer')
		expect(state.preferBatchQueueDelivery).toBe(false)
		expect(state.showTaskPhaseLabels).toBe(true)
		expect(state.projectsV2Enabled).toBe(true)
		expect(state.githubPrPanelEnabled).toBe(true)
		expect(state.firstTaskCompletedAt).toBe(1_700_000_000_100)
		expect(state.firstStructuredWorkflowCompletedAt).toBe(1_700_000_000_200)
		expect(state.firstInboundCommentReceivedAt).toBe(1_700_000_000_300)
	})

	test('a saved false replaces fresh defaults, including during the authoritative mutation guard', () => {
		const fresh = useSettingsStore.getInitialState()
		useSettingsStore.setState({
			experimentalSubagentsEnabled: fresh.experimentalSubagentsEnabled,
			effectiveSettings: fresh.effectiveSettings,
			orgSettings: fresh.orgSettings,
		})
		const disabled = makeResponse({
			userSettings: { experimentalSubagentsEnabled: false, haikuResearchSubagentsEnabled: false },
			effective: { experimentalSubagentsEnabled: false, haikuResearchSubagentsEnabled: false },
			orgSettings: { experimentalSubagentsEnabled: false, multiplayerPromptingEnabled: false },
		})
		useSettingsStore.getState().markMutationInFlight()
		useSettingsStore.getState().applyServerSettings(disabled, scope)
		expect(useSettingsStore.getState().experimentalSubagentsEnabled).toBe(true)
		expect(useSettingsStore.getState().effectiveSettings.experimentalSubagentsEnabled).toBe(false)
		expect(useSettingsStore.getState().orgSettings.experimentalSubagentsEnabled).toBe(false)
		expect(useSettingsStore.getState().orgSettings.multiplayerPromptingEnabled).toBe(false)
		useSettingsStore.setState({ _lastMutationAt: 0 })
		useSettingsStore.getState().applyServerSettings(disabled, scope)
		expect(useSettingsStore.getState().experimentalSubagentsEnabled).toBe(false)
	})

	test('keeps the local value for experiment flags the server has never stored', () => {
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)

		expect(useSettingsStore.getState().roundedCornersEnabled).toBe(true)
	})

	test('skips server-synced user settings inside the mutation guard window', () => {
		useSettingsStore.getState().markMutationInFlight()
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)

		const state = useSettingsStore.getState()
		// Local optimistic values must be preserved.
		expect(state.theme).toBe('catppuccin')
		expect(state.experimentalSubagentsEnabled).toBe(false)
		expect(state.haikuResearchSubagentsEnabled).toBe(false)
		expect(state.defaultModel).toBe('opus')
		expect(state.defaultClaudeCodeModel).toBe('opus')
		expect(state.defaultAgent).toBe('claude')
		expect(state.preferBatchQueueDelivery).toBe(true)
		expect(state.showTaskPhaseLabels).toBe(false)
		expect(state.projectsV2Enabled).toBe(false)
		expect(state.githubPrPanelEnabled).toBe(false)
		// Server milestones remain authoritative.
		expect(state.firstTaskCompletedAt).toBe(1_700_000_000_100)
		expect(state.firstStructuredWorkflowCompletedAt).toBe(1_700_000_000_200)
		expect(state.firstInboundCommentReceivedAt).toBe(1_700_000_000_300)
	})

	test('applies user settings once the mutation guard has elapsed', () => {
		// A mutation more than MUTATION_GUARD_MS (5s) ago no longer blocks sync.
		useSettingsStore.setState({ _lastMutationAt: Date.now() - 6_000 })
		useSettingsStore.getState().applyServerSettings(makeResponse(), scope)

		expect(useSettingsStore.getState().theme).toBe('dracula')
		expect(useSettingsStore.getState().defaultAgent).toBe('codelayer')
	})

	test('updates local streaming rendering preference', () => {
		useSettingsStore.getState().setStreamingRenderingEnabled(false)
		expect(useSettingsStore.getState().streamingRenderingEnabled).toBe(false)

		useSettingsStore.getState().setStreamingRenderingEnabled(true)
		expect(useSettingsStore.getState().streamingRenderingEnabled).toBe(true)
	})

	test('always applies org and effective settings even inside the guard window', () => {
		useSettingsStore.getState().markMutationInFlight()
		useSettingsStore.getState().applyServerSettings(
			makeResponse({
				effective: { experimentalSubagentsEnabled: true, haikuResearchSubagentsEnabled: true },
				orgSettings: { enableCreatingPubliclyShareableLinks: false, jiraIntegrationEnabled: true },
			}),
			scope,
		)

		const state = useSettingsStore.getState()
		expect(state.effectiveSettings.experimentalSubagentsEnabled).toBe(true)
		expect(state.effectiveSettings.haikuResearchSubagentsEnabled).toBe(true)
		expect(state.orgSettings.enableCreatingPubliclyShareableLinks).toBe(false)
		expect(state.orgSettings.jiraIntegrationEnabled).toBe(true)
		expect(state.orgSettings.multiplayerPromptingEnabled).toBe(true)
	})

	test('persists the last multiplayer prompting duration preset', () => {
		useSettingsStore.getState().setMultiplayerPromptingLastDuration('2h')
		expect(useSettingsStore.getState().multiplayerPromptingLastDuration).toBe('2h')
	})

	test('always applies integration flags even inside the guard window', () => {
		useSettingsStore.getState().markMutationInFlight()
		useSettingsStore.getState().applyServerSettings(
			makeResponse({
				effective: { jiraEnabled: true, linearEnabled: true },
				jiraNeedsReauth: true,
				jiraSiteUrl: 'https://example.atlassian.net',
				linearNeedsReauth: true,
			}),
			scope,
		)

		const state = useSettingsStore.getState()
		expect(state.jiraEnabled).toBe(true)
		expect(state.linearEnabled).toBe(true)
		expect(state.jiraNeedsReauth).toBe(true)
		expect(state.jiraSiteUrl).toBe('https://example.atlassian.net')
		expect(state.linearNeedsReauth).toBe(true)
	})

	test('rejects a late response from a previous authentication scope', () => {
		useSettingsStore.getState().applyServerSettings(makeResponse(), 'user-1:org-old')

		const state = useSettingsStore.getState()
		expect(state._serverSettingsAppliedScope).toBeNull()
		expect(state.firstInboundCommentReceivedAt).toBeNull()
		expect(state.experimentalSubagentsEnabled).toBe(false)
		expect(state.projectsV2Enabled).toBe(false)
		expect(state.effectiveSettings.experimentalSubagentsEnabled).toBe(false)
		expect(state.orgSettings.multiplayerPromptingEnabled).toBe(false)
	})

	test('hydrates cached Projects V2 false and reconciles only after a valid scoped response and mutation guard', async () => {
		const persisted = localStorage.getItem('riptide-settings')
		try {
			useSettingsStore.setState({ projectsV2Enabled: true })
			// setState persists, so restore the legacy snapshot before normal hydration.
			localStorage.setItem(
				'riptide-settings',
				JSON.stringify({ version: 41, state: { projectsV2Enabled: false } }),
			)
			await useSettingsStore.persist.rehydrate()
			expect(useSettingsStore.getState().projectsV2Enabled).toBe(false)
			useSettingsStore.getState().setServerSettingsScope('user-1:org-new')
			useSettingsStore.getState().applyServerSettings(makeResponse(), scope)
			expect(useSettingsStore.getState().projectsV2Enabled).toBe(false)
			useSettingsStore.getState().markMutationInFlight()
			useSettingsStore.getState().applyServerSettings(makeResponse(), 'user-1:org-new')
			expect(useSettingsStore.getState().projectsV2Enabled).toBe(false)
			useSettingsStore.setState({ _lastMutationAt: Date.now() - 6_000 })
			useSettingsStore.getState().applyServerSettings(makeResponse(), 'user-1:org-new')
			expect(useSettingsStore.getState().projectsV2Enabled).toBe(true)
		} finally {
			if (persisted === null) localStorage.removeItem('riptide-settings')
			else localStorage.setItem('riptide-settings', persisted)
		}
	})
})
