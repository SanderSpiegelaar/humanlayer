import { useAuth } from '@workos-inc/authkit-react'

import { useMountEffect } from '@/hooks/useMountEffect'
import {
	identifyPostHogUser,
	initPostHog,
	isPostHogEnabled,
	resetPostHogIdentity,
} from '@/integrations/posthog/posthog'
import { subscribeToWorkflowSelectorAssignment } from '@/integrations/posthog/workflow-selector-assignment'

/**
 * Initializes PostHog once and identifies the authenticated WorkOS user.
 * Renders nothing.
 */
export function PostHogHandler() {
	const { user } = useAuth()

	if (!isPostHogEnabled() || !user) return null

	// Keyed by user ID so a different signed-in user re-identifies.
	return <PostHogIdentifiedSession key={user.id} userId={user.id} />
}

function PostHogIdentifiedSession({ userId }: { userId: string }) {
	useMountEffect(() => {
		initPostHog()
		identifyPostHogUser(userId)

		const stopWorkflowSelector = subscribeToWorkflowSelectorAssignment(userId)
		return () => {
			stopWorkflowSelector()
		}
	})

	useMountEffect(() => () => resetPostHogIdentity())

	return null
}
