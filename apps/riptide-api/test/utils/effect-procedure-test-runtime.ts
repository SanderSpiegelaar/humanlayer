import { NodeCrypto } from '@effect/platform-node'
import type { EffectDecoratedProcedure, EffectErrorMap } from '@humanlayer/effect-orpc'
import type { AnySchema, Meta } from '@orpc/contract'
import type { Context } from '@orpc/server'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { ConfigProvider, Effect, Layer, ManagedRuntime, Redacted } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import type { HttpClient } from 'effect/http/HttpClient'

import type { AppRuntime, AppRuntimeInitializationError, AppRuntimeServices } from '../../src/effects/app-runtime'
import {
	type AccessRequestService,
	AccessRequestServiceLive,
} from '../../src/effects/services/access-request/access-request.service'
import { ArtifactCommentsLive } from '../../src/effects/services/artifact-comments/artifact-comments-live'
import { DiffCommentsLive } from '../../src/effects/services/diff-comments/diff-comments-live'
import { DurableStreamsConfig } from '../../src/effects/services/durable-streams/durable-streams-config.service'
import { DurableStreamSessionServiceLive } from '../../src/effects/services/durable-streams/streams'
import { ExperimentAnalyticsService } from '../../src/effects/services/experiment-analytics/experiment-analytics.service'
import { GitHubService } from '../../src/effects/services/github/github.service'
import { PersonSpendAnalyticsLive } from '../../src/effects/services/metrics/person-spend-analytics.service'
import { OnboardingServiceLive } from '../../src/effects/services/onboarding/onboarding.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { PostgresReadReplicaDbLive } from '../../src/effects/services/postgres/postgres-read-replica.service'
import { PrStatusStream } from '../../src/effects/services/pr-status-stream/pr-status-stream.service'
import { ResendConfig } from '../../src/effects/services/resend/resend-config.service'
import { ResendService } from '../../src/effects/services/resend/resend.service'
import { S3 } from '../../src/effects/services/s3/s3.service'
import { SessionTitleGeneration } from '../../src/effects/services/session-title-generation/session-title-generation.service'
import { SlackService } from '../../src/effects/services/slack/slack.service'
import { TaskDiffServiceLive } from '../../src/effects/services/task-diff-durable-streams/task-diff-durable-streams.service'
import { TaskIntentClassifier } from '../../src/effects/services/task-intent-classifier/task-intent-classifier.service'
import { TaskLaunchServiceLive } from '../../src/effects/services/task-launch/task-launch.live'
import { WorkosClientError } from '../../src/effects/services/workos/workos.errors'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { WorkspaceSetupServiceLive } from '../../src/effects/services/workspace-setup/workspace-setup.live'
import { WorkspaceSetupPersistenceLive } from '../../src/effects/services/workspace-setup/workspace-setup.persistence'
import type { WorkosSdkAdapter } from '../../src/lib/workos-service'

export type TestRuntimeOptions = {
	durableStreamsOrigin?: string
	/**
	 * Backs `PostgresReadReplicaDb`. Defaults to the same database as the
	 * primary, which is what production does locally too
	 * (`READ_REPLICA_DATABASE_URL` = `DATABASE_URL`). Pass a second database
	 * only when the test is ABOUT replica lag.
	 */
	readReplicaDb?: PgDatabase<PostgresJsQueryResultHKT>
	workos?: Layer.Layer<WorkosService>
	resendConfig?: Layer.Layer<ResendConfig>
	resend?: Layer.Layer<ResendService>
	accessRequests?: Layer.Layer<AccessRequestService>
	slack?: Layer.Layer<SlackService>
	github?: Layer.Layer<GitHubService>
	prStatusStream?: Layer.Layer<PrStatusStream>
	experimentAnalytics?: Layer.Layer<ExperimentAnalyticsService>
	s3?: Layer.Layer<S3>
	taskIntentClassifier?: Layer.Layer<TaskIntentClassifier>
	sessionTitleGeneration?: Layer.Layer<SessionTitleGeneration>
	/**
	 * The transport the runtime hands to services that declare HttpClient. Defaults to the real
	 * fetch transport, as production does. Override it when a test must not reach the network.
	 */
	httpClient?: Layer.Layer<HttpClient>
}

function testDurableStreamsConfigLayer(origin: string) {
	return Layer.succeed(DurableStreamsConfig, {
		origin,
		contentType: 'application/json',
		ttlSeconds: 600,
		streamUrl: (sessionId: string) => `${origin}/v1/stream/sessions/${sessionId}`,
	})
}

const fakeWorkos = {
	listActiveAdmins: () => Effect.succeed([]),
	sendInvitation: () => Effect.die('sendInvitation not implemented in test runtime'),
	getUser: ({ userId }: { userId: string }) =>
		Effect.succeed({ userId, email: `${userId}@example.test`, firstName: null, lastName: null, avatarUrl: null }),
	hasPendingInvitation: () => Effect.succeed(false),
	countActiveOrganizationMemberships: () => Effect.succeed(0),
	countPendingInvitations: () => Effect.succeed(0),
	listUsersByEmail: () => Effect.succeed([]),
	listActiveOrganizationMemberships: () => Effect.succeed([]),
	createUserApiKey: () => Effect.die('createUserApiKey not implemented in test runtime'),
	listUserApiKeys: () => Effect.die('listUserApiKeys not implemented in test runtime'),
	validateApiKey: () => Effect.die('validateApiKey not implemented in test runtime'),
	deleteApiKey: () => Effect.die('deleteApiKey not implemented in test runtime'),
}
export const makeTestWorkosService = (
	overrides: Partial<typeof WorkosService.Service> = {},
): typeof WorkosService.Service => ({ ...fakeWorkos, ...overrides })

export const defaultTestWorkosLayer = Layer.succeed(WorkosService, makeTestWorkosService())

export const workosLayerFromTestSdkAdapter = (workos: WorkosSdkAdapter) =>
	Layer.succeed(
		WorkosService,
		makeTestWorkosService({
			getUser: ({ userId }) =>
				Effect.tryPromise({
					try: async () => {
						const user = await workos.userManagement.getUser(userId)
						return {
							userId: user.id,
							email: user.email,
							firstName: user.firstName ?? null,
							lastName: user.lastName ?? null,
							avatarUrl: user.profilePictureUrl ?? null,
						}
					},
					catch: (cause) => new WorkosClientError({ cause }),
				}),
		}),
	)

export const createTestOnboardingLayer = (
	db: PgDatabase<PostgresJsQueryResultHKT>,
	workosLayer = defaultTestWorkosLayer,
) =>
	OnboardingServiceLive.pipe(
		Layer.provide(Layer.mergeAll(PostgresDbLive(db), workosLayer, fakeResendLayer, OnboardingConfigTestLayer)),
	)

const fakeResendConfigLayer = Layer.succeed(ResendConfig, {
	apiKey: Redacted.make('re_test_key'),
	apiBaseUrl: 'https://resend.example.test',
	fromEmail: 'test@example.com',
	cloudOrigin: 'https://cloud.example.com',
	appOrigin: 'https://app.example.com',
})

const fakeResendLayer = Layer.succeed(ResendService, {
	sendPlaintext: () => Effect.succeed({ emailId: 'test-email-id' }),
	schedulePlaintext: (input) =>
		Effect.succeed({ emailId: 'test-scheduled-email-id', scheduledAt: input.scheduledAt.toISOString() }),
	cancelScheduled: () => Effect.void,
	getContact: () => Effect.succeed(null),
	upsertContact: () => Effect.succeed({ contactId: 'contact-test' }),
	patchContactProperties: () => Effect.succeed({ contactId: 'contact-test' }),
	sendEvent: () => Effect.void,
})

const OnboardingConfigTestLayer = ConfigProvider.layer(
	ConfigProvider.fromUnknown({
		ONBOARDING_CAMPAIGN_ENABLED: 'true',
		ONBOARDING_WELCOME_ONLY_PERCENT: '100',
		ONBOARDING_LITE_PERCENT: '0',
		RESEND_PRODUCT_USERS_SEGMENT_ID: 'segment-product-users-test',
	}),
)

const s3TestLayer = Layer.succeed(S3, {
	getPresignedDownloadUrl: (key: string) =>
		Effect.succeed(`https://example.test/download/${encodeURIComponent(key)}`),
	getPresignedUploadUrl: (key: string) => Effect.succeed(`https://example.test/upload/${encodeURIComponent(key)}`),
	presignDownload: ({ key }) => Effect.succeed(`https://example.test/download/${encodeURIComponent(key)}`),
	presignUpload: ({ key }) => Effect.succeed(`https://example.test/upload/${encodeURIComponent(key)}`),
	uploadArtifactBytes: () => Effect.void,
})

export const fakeSlackLayer = Layer.succeed(SlackService, {
	createInstallUrl: () => Effect.die('createInstallUrl not implemented in test runtime'),
	exchangeCode: () => Effect.die('exchangeCode not implemented in test runtime'),
	getStatus: () => Effect.die('getStatus not implemented in test runtime'),
	disconnect: () => Effect.die('disconnect not implemented in test runtime'),
	listChannels: () => Effect.die('listChannels not implemented in test runtime'),
	dispatchArtifactEvent: () => Effect.void,
	dispatchCommentEvent: () => Effect.void,
	verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not implemented in test runtime'),
	handleInteractionPayload: () => Effect.void,
})

const fakeGitHubLayer = Layer.succeed(GitHubService, {
	createInstallUrl: () => Effect.die('createInstallUrl not implemented in test runtime'),
	completeInstallation: () => Effect.die('completeInstallation not implemented in test runtime'),
	listConnections: () => Effect.die('listConnections not implemented in test runtime'),
	getConnection: () => Effect.die('getConnection not implemented in test runtime'),
	mutatePullRequest: () => Effect.die('mutatePullRequest not implemented in test runtime'),
	listRepositories: () => Effect.die('listRepositories not implemented in test runtime'),
	getIssuePreview: () => Effect.die('getIssuePreview not implemented in test runtime'),
	prepareIssueImport: () => Effect.die('prepareIssueImport not implemented in test runtime'),
	syncArtifactBacklink: () => Effect.die('syncArtifactBacklink not implemented in test runtime'),
	refreshConnection: () => Effect.die('refreshConnection not implemented in test runtime'),
	disconnect: () => Effect.die('disconnect not implemented in test runtime'),
	fetchPullRequest: () => Effect.die('fetchPullRequest not implemented in test runtime'),
	verifyWebhook: () => Effect.die('verifyWebhook not implemented in test runtime'),
	handleWebhook: () => Effect.void,
})

/**
 * The PR-status stream writer for procedure tests that never touch it.
 *
 * Every method dies, like the other fakes here: a procedure that writes to the stream unexpectedly
 * should fail loudly rather than silently succeed against a no-op. The one suite that does
 * exercise the stream — `procedures/github-ensure-stream.test.ts` — passes its own
 * `prStatusStream` layer and asserts on what it recorded.
 */
const fakePrStatusStreamLayer = Layer.succeed(PrStatusStream, {
	hydrate: () => Effect.die('PrStatusStream.hydrate not implemented in test runtime'),
	publishChecks: () => Effect.die('PrStatusStream.publishChecks not implemented in test runtime'),
	publishPullRequest: () => Effect.die('PrStatusStream.publishPullRequest not implemented in test runtime'),
})

const fakeExperimentAnalyticsLayer = Layer.succeed(ExperimentAnalyticsService, {
	recordTaskComposerTaskCreated: () => Effect.void,
	recordCodingAgentSessionCreated: () => Effect.void,
	recordProjectsV2Assigned: () => Effect.void,
})

const fakeTaskIntentClassifierLayer = Layer.succeed(TaskIntentClassifier, {
	classify: (text) =>
		Effect.succeed(
			text.startsWith('How does')
				? 'research'
				: text.startsWith("Let's make a plan")
					? 'design'
					: text.startsWith('Unclear')
						? 'unknown'
						: 'implementation',
		),
})

const fakeSessionTitleGenerationLayer = Layer.succeed(SessionTitleGeneration, {
	scheduleGeneration: () => Effect.void,
})

export function createRuntimeWithTestPostgresLayer(
	db: PgDatabase<PostgresJsQueryResultHKT>,
	options?: TestRuntimeOptions,
): AppRuntime {
	const durableStreamsOrigin =
		options?.durableStreamsOrigin ?? process.env.DURABLE_STREAMS_ORIGIN ?? 'http://durable-streams.test'
	const durableStreamsConfig = testDurableStreamsConfigLayer(durableStreamsOrigin)
	const taskDiffConfig = ConfigProvider.layer(
		ConfigProvider.fromUnknown({ DURABLE_STREAMS_ORIGIN: durableStreamsOrigin }),
	)

	const workosLayer = options?.workos ?? defaultTestWorkosLayer
	const resendConfigLayer = options?.resendConfig ?? fakeResendConfigLayer
	const resendLayer = options?.resend ?? fakeResendLayer
	const accessRequestsLayer =
		options?.accessRequests ??
		Layer.provideMerge(
			AccessRequestServiceLive,
			Layer.mergeAll(PostgresDbLive(db), workosLayer, resendLayer, resendConfigLayer),
		)
	const onboardingLayer = createTestOnboardingLayer(db, workosLayer)
	const slackLayer = options?.slack ?? fakeSlackLayer
	const workspaceSetupLayer = WorkspaceSetupServiceLive.pipe(
		Layer.provide(WorkspaceSetupPersistenceLive),
		Layer.provide(PostgresDbLive(db)),
	)
	const commentLayers = Layer.mergeAll(DiffCommentsLive, ArtifactCommentsLive).pipe(
		Layer.provide(Layer.mergeAll(PostgresDbLive(db), workosLayer, onboardingLayer, slackLayer)),
	)

	return ManagedRuntime.make(
		Layer.mergeAll(
			PostgresDbLive(db),
			NodeCrypto.layer,
			PostgresReadReplicaDbLive(options?.readReplicaDb ?? db),
			PersonSpendAnalyticsLive,
			options?.s3 ?? s3TestLayer,
			workosLayer,
			resendConfigLayer,
			resendLayer,
			accessRequestsLayer,
			durableStreamsConfig,
			DurableStreamSessionServiceLive,
			TaskDiffServiceLive.pipe(Layer.provide(Layer.mergeAll(FetchHttpClient.layer, taskDiffConfig)), Layer.orDie),
			onboardingLayer,
			commentLayers,
			workspaceSetupLayer,
			TaskLaunchServiceLive,
			options?.taskIntentClassifier ?? fakeTaskIntentClassifierLayer,
			options?.sessionTitleGeneration ?? fakeSessionTitleGenerationLayer,
			slackLayer,
			options?.github ?? fakeGitHubLayer,
			options?.prStatusStream ?? fakePrStatusStreamLayer,
			options?.experimentAnalytics ?? fakeExperimentAnalyticsLayer,
		)
			// Mirrors production: one transport, provided once, ambient to every service that needs it.
			.pipe(Layer.provideMerge(options?.httpClient ?? FetchHttpClient.layer)),
	)
}

export function createDefaultTestEffectRuntime(options?: TestRuntimeOptions): AppRuntime {
	return createRuntimeWithTestPostgresLayer({} as PgDatabase<PostgresJsQueryResultHKT>, options)
}

export function bindProcedureToRuntime<
	TInitialContext extends Context,
	TCurrentContext extends Context,
	TInputSchema extends AnySchema,
	TOutputSchema extends AnySchema,
	TErrorMap extends EffectErrorMap,
	TMeta extends Meta,
>(
	procedure: EffectDecoratedProcedure<
		TInitialContext,
		TCurrentContext,
		TInputSchema,
		TOutputSchema,
		TErrorMap,
		TMeta,
		AppRuntimeServices,
		AppRuntimeInitializationError
	>,
	runtime: AppRuntime,
) {
	return procedure.withRuntime(runtime)
}
