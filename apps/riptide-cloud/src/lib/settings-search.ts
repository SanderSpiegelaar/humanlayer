import z from 'zod/v4'

export const settingsSearchSchema = z.object({
	slack_error: z.string().optional(),
	github: z.enum(['connected', 'unclaimed']).optional(),
	github_error: z.enum(['invalid_link', 'conflict', 'unavailable']).optional(),
})

export type SettingsSearch = z.infer<typeof settingsSearchSchema>
export type GitHubCallbackResult = NonNullable<SettingsSearch['github'] | SettingsSearch['github_error']>
