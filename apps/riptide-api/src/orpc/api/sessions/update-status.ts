import { Effect } from 'effect'

import { effectOrpcBaseOrganizationRequired } from '../../effect-base'

/** @deprecated Claude Code Terminal UI has been removed. */
export const updateSessionStatusProcedure = effectOrpcBaseOrganizationRequired.sessions.updateStatus.effect(function* ({
	errors,
}) {
	return yield* Effect.fail(
		errors.BAD_REQUEST({
			data: { message: 'Claude Code Terminal UI has been removed' },
		}),
	)
})
