import posthog from 'posthog-js'

import { logger } from '@/lib/logger'

/**
 * PostHog product-analytics integration.
 *
 * Fully gated on VITE_PUBLIC_POSTHOG_KEY: when no key is configured, PostHog is
 * never initialized.
 */

export const WORKFLOW_SELECTOR_FLAG = 'prompt-first-workflow-selector'
export type WorkflowSelectorVariant = 'named' | 'task-size'

const POSTHOG_KEY: string | undefined = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST: string = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

export const POSTHOG_INIT_CONFIG = {
	api_host: POSTHOG_HOST,
	person_profiles: 'identified_only',
	autocapture: false,
	capture_pageview: false,
	capture_pageleave: false,
	disable_session_recording: true,
	disable_surveys: true,
	disable_web_experiments: true,
	disable_external_dependency_loading: true,
} satisfies NonNullable<Parameters<typeof posthog.init>[1]>

let initialized = false

export interface PostHogAdapter {
	init: typeof posthog.init
	identify: typeof posthog.identify
	reset: typeof posthog.reset
	onFeatureFlags: typeof posthog.onFeatureFlags
	getFeatureFlag: typeof posthog.getFeatureFlag
	capture: typeof posthog.capture
	get_distinct_id: typeof posthog.get_distinct_id
}

const adapter: PostHogAdapter = posthog

export function isPostHogEnabled(): boolean {
	return Boolean(POSTHOG_KEY)
}

/** Initialize PostHog once per app load. No-op when no key is configured. */
export function initPostHog(): void {
	if (!POSTHOG_KEY || initialized) return
	try {
		adapter.init(POSTHOG_KEY, POSTHOG_INIT_CONFIG)
		initialized = true
	} catch (error) {
		logger.error('Failed to initialize PostHog', error)
	}
}

/** Identify the current user with their WorkOS user ID. */
export function identifyPostHogUser(userId: string): void {
	if (!isPostHogEnabled() || !initialized) return
	try {
		adapter.identify(userId)
	} catch (error) {
		logger.error('Failed to identify PostHog user', error)
	}
}

export function resetPostHogIdentity(): void {
	if (!isPostHogEnabled() || !initialized) return
	try {
		adapter.reset()
	} catch (error) {
		logger.error('Failed to reset PostHog identity', error)
	}
}

export function capturePostHogEvent(event: string, properties: Record<string, unknown>): void {
	if (!isPostHogEnabled() || !initialized) return
	try {
		adapter.capture(event, properties)
	} catch (error) {
		logger.error('Failed to capture PostHog event', error)
	}
}

export function resolveWorkflowSelectorFlag(value: string | boolean | undefined): WorkflowSelectorVariant {
	return value === true || value === 'task-size' ? 'task-size' : 'named'
}

export function onWorkflowSelectorFlag(callback: (assignment: WorkflowSelectorVariant) => void): () => void {
	if (!isPostHogEnabled() || !initialized) {
		callback('named')
		return () => {}
	}
	return adapter.onFeatureFlags(() => {
		callback(resolveWorkflowSelectorFlag(adapter.getFeatureFlag(WORKFLOW_SELECTOR_FLAG)))
	})
}
