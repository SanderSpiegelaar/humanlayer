import {
	InvitationForm as InvitationFormPresentation,
	type CreateInvitationInput,
} from '@humanlayer/ui/administration/InvitationForm'
import { isDefinedError } from '@orpc/client'
import * as Sentry from '@sentry/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/api/client'

export function InvitationForm({ defaultEmail, onSubmitted }: { defaultEmail?: string; onSubmitted: () => void }) {
	const { queryClient: api } = useRiptideApi()
	const cache = useQueryClient()
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const refreshRequestQueue = () =>
		Promise.all([
			cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.list.key() }),
			cache.invalidateQueries({ queryKey: api.auth.admin.accessRequests.unreadCount.key() }),
		])

	const create = useMutation(
		api.auth.admin.invitations.create.mutationOptions({
			onSuccess: async () => {
				setErrorMessage(null)
				toast.success('Invitation sent')
				await Promise.all([
					cache.invalidateQueries({ queryKey: api.auth.admin.invitations.list.key() }),
					refreshRequestQueue(),
				])
				onSubmitted()
			},
			onError: async (error) => {
				if (isDefinedError(error) && (error.code === 'ALREADY_INVITED' || error.code === 'ALREADY_A_MEMBER')) {
					setErrorMessage(error.data.message)
					await refreshRequestQueue()
					return
				}
				Sentry.captureException(error, { tags: { action: 'create_invitation' } })
				setErrorMessage('Could not send invitation. Check the invitation list before retrying.')
			},
		}),
	)

	return (
		<InvitationFormPresentation
			defaultEmail={defaultEmail}
			isPending={create.isPending}
			errorMessage={errorMessage}
			onSubmit={(input: CreateInvitationInput) => {
				setErrorMessage(null)
				create.mutate(input)
			}}
		/>
	)
}
