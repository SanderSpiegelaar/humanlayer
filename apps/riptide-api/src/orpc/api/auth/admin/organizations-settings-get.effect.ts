import { organizationSettings, type DefaultTaskShareLevel } from '@humanlayer/db/tables/organization-settings'
import { ORGANIZATION_FEATURE_DEFAULTS } from '@humanlayer/db/utils/settings-defaults'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const getOrgSettingsEffectProcedure =
	effectOrpcBaseForOrganizationAdmin.auth.admin.organizations.settings.get.effect(function* ({ context, errors }) {
		// services
		const postgres = yield* PostgresDb

		// impl
		const { organizationId } = context.auth

		return yield* postgres
			.query(
				postgres.client
					.select()
					.from(organizationSettings)
					.where(eq(organizationSettings.organization_id, organizationId)),
			)
			.pipe(
				Effect.map((rows) => {
					const row = rows[0]
					const defaultTaskShareLevel: DefaultTaskShareLevel = row?.default_task_share_level ?? 'edit'

					return {
						experimentalSubagentsEnabled:
							row?.experimental_subagents_enabled ??
							ORGANIZATION_FEATURE_DEFAULTS.experimental_subagents_enabled,
						haikuResearchSubagentsEnabled:
							row?.haiku_research_subagents_enabled ??
							ORGANIZATION_FEATURE_DEFAULTS.haiku_research_subagents_enabled,
						jiraIntegrationEnabled: row?.jira_integration_enabled ?? false,
						linearIntegrationEnabled: row?.linear_integration_enabled ?? false,
						slackIntegrationEnabled: row?.slack_integration_enabled ?? false,
						githubIntegrationEnabled: row?.github_integration_enabled ?? false,
						multiplayerPromptingEnabled:
							row?.multiplayer_prompting_enabled ??
							ORGANIZATION_FEATURE_DEFAULTS.multiplayer_prompting_enabled,
						defaultTaskShareLevel,
						syncVersion: 2 as const,
						syncVisibility: 'v2' as const,
						enableCreatingPubliclyShareableLinks: row?.enable_creating_publicly_shareable_links ?? true,
						accessRequestsEnabled: row?.access_requests_enabled ?? true,
						commitTrackingEnabled: row?.commit_tracking_enabled ?? false,
						prTrackingEnabled: row?.pr_tracking_enabled ?? false,
						advancedMetricsVisibleToAllMembers: row?.advanced_metrics_visible_to_all_members ?? false,
					}
				}),
				Effect.tap(() =>
					Effect.logInfo('Organization settings fetched').pipe(Effect.annotateLogs({ organizationId })),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)
	})
