import { DefaultTaskShareLevelSchema } from '@humanlayer/db/tables/organization-settings'
import { StatusCodes } from 'http-status-codes'
import z from 'zod/v4'

import { contractBuilder } from '../../../contract-builder'
import { SyncVersionSchema, SyncVisibilitySchema } from '../../../types/sync'

export const SetOrgSettingsInputSchema = z.object({
	experimentalSubagentsEnabled: z.boolean().optional(),
	haikuResearchSubagentsEnabled: z.boolean().optional(),
	jiraIntegrationEnabled: z.boolean().optional(),
	linearIntegrationEnabled: z.boolean().optional(),
	slackIntegrationEnabled: z.boolean().optional(),
	githubIntegrationEnabled: z.boolean().optional(),
	multiplayerPromptingEnabled: z.boolean().optional(),
	defaultTaskShareLevel: DefaultTaskShareLevelSchema.optional(),
	/** @deprecated Accepted for backward compatibility and ignored. */
	syncVersion: SyncVersionSchema.optional(),
	/** @deprecated Accepted for backward compatibility and ignored. */
	syncVisibility: SyncVisibilitySchema.optional(),
	enableCreatingPubliclyShareableLinks: z.boolean().optional(),
	accessRequestsEnabled: z.boolean().optional(),
	commitTrackingEnabled: z.boolean().optional(),
	prTrackingEnabled: z.boolean().optional(),
	/** Opens Advanced Metrics to every member of the org, not just its admins. */
	advancedMetricsVisibleToAllMembers: z.boolean().optional(),
})

export const SetOrgSettingsOutputSchema = z.object({
	experimentalSubagentsEnabled: z.boolean(),
	haikuResearchSubagentsEnabled: z.boolean(),
	jiraIntegrationEnabled: z.boolean(),
	linearIntegrationEnabled: z.boolean(),
	slackIntegrationEnabled: z.boolean(),
	githubIntegrationEnabled: z.boolean(),
	multiplayerPromptingEnabled: z.boolean(),
	defaultTaskShareLevel: DefaultTaskShareLevelSchema,
	/** @deprecated Always returns 2. */
	syncVersion: SyncVersionSchema,
	/** @deprecated Always returns 'v2'. */
	syncVisibility: SyncVisibilitySchema,
	enableCreatingPubliclyShareableLinks: z.boolean(),
	accessRequestsEnabled: z.boolean(),
	commitTrackingEnabled: z.boolean(),
	prTrackingEnabled: z.boolean(),
	advancedMetricsVisibleToAllMembers: z.boolean(),
})

export const setOrgSettingsContract = contractBuilder
	.input(SetOrgSettingsInputSchema)
	.output(SetOrgSettingsOutputSchema)
	.errors({
		GITHUB_INSTALLATION_REQUIRED: {
			status: StatusCodes.PRECONDITION_FAILED,
			data: z.object({ message: z.string() }),
		},
		COMMIT_TRACKING_REQUIRED: {
			status: StatusCodes.PRECONDITION_FAILED,
			data: z.object({ message: z.string() }),
		},
	})
