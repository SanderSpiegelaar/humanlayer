import { createSignedLaunchToken } from '../../../../auth/daemon-tokens'
import logger from '../../../../logger'
import { apiBaseOrgRequired } from '../../../base'

export const createLaunchTokenProcedure = apiBaseOrgRequired.auth.daemon.launchToken.create.handler(
	async ({ context, errors }) => {
		try {
			const token = await createSignedLaunchToken(context.auth.userId, context.auth.organizationId)
			const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
			return { token, expiresAt }
		} catch (error) {
			logger.error(error)
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
