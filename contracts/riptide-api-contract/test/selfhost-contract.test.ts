import { describe, expect, test } from 'vitest'

import { CreateOrganizationOutputSchema } from '../src/api/auth/user/organizations-create'
import { RiptideApiContract } from '../src/contract-router'

describe('self-hosted API contracts', () => {
	test('does not expose commercial RPCs', () => {
		expect(RiptideApiContract).not.toHaveProperty('billing')
		expect(RiptideApiContract.auth.admin).not.toHaveProperty('billing')
	})

	test('organization creation returns organization data without customer state', () => {
		expect(
			CreateOrganizationOutputSchema.parse({
				organizationId: 'organization',
				workosOrganizationId: 'workos_organization',
				organizationName: 'Self-hosted',
			}),
		).toEqual({
			organizationId: 'organization',
			workosOrganizationId: 'workos_organization',
			organizationName: 'Self-hosted',
			failedInvites: [],
		})
	})
})
