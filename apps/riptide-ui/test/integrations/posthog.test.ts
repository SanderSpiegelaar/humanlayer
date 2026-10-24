import { describe, expect, test } from 'vitest'

import {
	capturePostHogEvent,
	identifyPostHogUser,
	initPostHog,
	isPostHogEnabled,
	onWorkflowSelectorFlag,
	POSTHOG_INIT_CONFIG,
	resetPostHogIdentity,
	resolveWorkflowSelectorFlag,
} from '@/integrations/posthog/posthog'

describe('PostHog adapter configuration', () => {
	test('allows named events and flags without broad browser capture', () => {
		expect(POSTHOG_INIT_CONFIG).toMatchObject({
			autocapture: false,
			capture_pageview: false,
			capture_pageleave: false,
			disable_session_recording: true,
			disable_surveys: true,
			disable_web_experiments: true,
			disable_external_dependency_loading: true,
		})
		expect(POSTHOG_INIT_CONFIG).not.toHaveProperty('advanced_disable_feature_flags', true)
		expect(POSTHOG_INIT_CONFIG).not.toHaveProperty('disable_feature_flags', true)
	})
})

describe('workflow selector flag', () => {
	test.each([
		[true, 'task-size'],
		['task-size', 'task-size'],
		[undefined, 'named'],
		[false, 'named'],
		['named', 'named'],
		['control', 'named'],
		['unknown', 'named'],
	] as const)('maps PostHog variant %s to %s', (value, expected) => {
		expect(resolveWorkflowSelectorFlag(value)).toBe(expected)
	})

	test('keeps analytics inert and supplies the workflow fallback without a PostHog key', () => {
		expect(isPostHogEnabled()).toBe(false)
		expect(() => {
			initPostHog()
			identifyPostHogUser('user-a')
			capturePostHogEvent('test-event', {})
			resetPostHogIdentity()
		}).not.toThrow()
		const assignments: string[] = []
		const unsubscribe = onWorkflowSelectorFlag((variant) => {
			assignments.push(variant)
		})
		unsubscribe()
		expect(assignments).toEqual(['named'])
	})
})
