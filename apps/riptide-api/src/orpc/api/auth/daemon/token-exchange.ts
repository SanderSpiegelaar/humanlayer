import { createSignedDaemonToken } from '../../../../auth/daemon-tokens'
import logger from '../../../../logger'
import { apiBaseLaunchToken } from '../../../base'

export const exchangeLaunchTokenProcedure = apiBaseLaunchToken.auth.daemon.token.exchange.handler(
	async ({ input, context, errors }) => {
		try {
			const token = await createSignedDaemonToken(
				context.launchTokenAuth.userId,
				context.launchTokenAuth.organizationId,
				input.hostId,
			)
			return { token }
		} catch (error) {
			logger.error(error)
			throw errors.INTERNAL_SERVER_ERROR()
		}
	},
)
