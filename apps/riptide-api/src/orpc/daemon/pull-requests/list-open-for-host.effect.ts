import { effectOrpcDaemonBase } from '../../effect-base'

/**
 * Always empty. The server refreshes open pull requests itself through the GitHub App, and a
 * daemon that still sweeps must find nothing to do rather than a route that is gone.
 */
export const listOpenPullRequestsForHostProcedure = effectOrpcDaemonBase.pullRequests.listOpenForHost.effect(
	function* () {
		return { pullRequests: [] }
	},
)
