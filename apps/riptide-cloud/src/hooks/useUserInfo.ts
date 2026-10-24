import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { useRiptideApi } from '@/api/client'

/**
 * Returns the current user's info including the database organization UUID.
 *
 * The WorkOS `organizationId` from `useAuth()` is NOT a UUID — it's a
 * WorkOS-format string like `org_01HXYZ...`.  The database `organization_id`
 * column is a real UUID, and this hook exposes it via the `auth.user.info`
 * endpoint so callers (e.g. optimistic inserts) can use the correct value.
 */
export function useUserInfo() {
	const { queryClient } = useRiptideApi()
	const { organizationId } = useAuth()

	const { data, isLoading } = useQuery({
		...queryClient.auth.user.info.queryOptions({}),
		staleTime: Number.POSITIVE_INFINITY,
		enabled: !!organizationId,
	})

	return {
		dbOrganizationId: data?.organizationId,
		userId: data?.userId,
		advancedMetricsVisible: data?.advancedMetricsVisible ?? false,
		// Collection flags — Advanced Metrics locks the tabs whose pipeline is off.
		commitTrackingEnabled: data?.commitTrackingEnabled ?? false,
		prTrackingEnabled: data?.prTrackingEnabled ?? false,
		isLoading,
	}
}
