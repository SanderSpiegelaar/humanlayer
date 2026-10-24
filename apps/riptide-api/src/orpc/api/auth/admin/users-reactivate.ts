import { ORPCError } from '@orpc/server'
import * as Sentry from '@sentry/node'

import { logger } from '../../../../logger'
import { apiBaseForOrganizationAdmin } from '../../../base'

export const adminReactivateUserProcedure = apiBaseForOrganizationAdmin.auth.admin.users.reactivate.handler(
	async ({ context, input, errors }) => {
		const {
			auth,
			services: { workos },
		} = context

		let stage = 'membership_lookup'
		try {
			const membershipsResult = await workos.userManagement.listOrganizationMemberships({
				userId: input.userId,
				organizationId: auth.workosOrganizationId,
				statuses: ['active', 'inactive'],
				limit: 1,
			})
			const memberships = await membershipsResult.autoPagination()
			const membership = memberships[0]

			if (!membership) {
				throw errors.USER_NOT_FOUND({ data: { message: 'User not found in organization' } })
			}

			if (membership.status !== 'inactive') {
				throw errors.INVALID_STATE({ data: { message: 'User membership is not inactive' } })
			}

			stage = 'workos_reactivation'
			await workos.userManagement.reactivateOrganizationMembership(membership.id)

			return { success: true as const }
		} catch (error: unknown) {
			if (error instanceof ORPCError && (error.code === 'USER_NOT_FOUND' || error.code === 'INVALID_STATE')) {
				throw error
			}

			const observabilityContext = {
				operation: 'reactivate_user',
				organizationId: auth.organizationId,
				workosOrganizationId: auth.workosOrganizationId,
				userId: input.userId,
				stage,
			}
			logger.error({ error, ...observabilityContext }, 'Failed to reactivate user')
			Sentry.captureException(error, { extra: observabilityContext })
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
