import { Button } from '@humanlayer/ui/components/button'
import { Separator } from '@humanlayer/ui/components/separator'
import { createFileRoute } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { IntegrationsSection } from '@/components/settings/IntegrationsSection'
import { OptionalFeaturesSection } from '@/components/settings/OptionalFeaturesSection'
import { OrganizationDomainsSection } from '@/components/settings/OrganizationDomainsSection'
import { TaskSharingSection } from '@/components/settings/TaskSharingSection'
import { useUserInfo } from '@/hooks/useUserInfo'
import { settingsSearchSchema } from '@/lib/settings-search'

export const Route = createFileRoute('/settings')({
	component: SettingsPage,
	validateSearch: settingsSearchSchema,
})

function OrganizationIdBlock() {
	const { dbOrganizationId } = useUserInfo()
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		if (!dbOrganizationId) return
		await navigator.clipboard.writeText(dbOrganizationId)
		setCopied(true)
		toast.success('Organization ID copied to clipboard')
		setTimeout(() => setCopied(false), 2000)
	}

	return (
		<div className="max-w-5xl mb-8">
			<p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Organization ID</p>
			<div className="relative">
				<pre className="overflow-x-auto rounded-lg bg-muted p-4 pr-14 font-mono text-sm">
					<code>{dbOrganizationId ?? '—'}</code>
				</pre>
				<Button
					onClick={handleCopy}
					variant="outline"
					size="icon"
					className="absolute right-2 top-2 h-8 w-8"
					disabled={!dbOrganizationId}
					aria-label="Copy organization ID"
				>
					{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
				</Button>
			</div>
		</div>
	)
}

function SettingsPage() {
	const { isLoading, user, organizationId, role, roles } = useAuth()

	if (isLoading || !user || !organizationId || !role || !roles) return null
	if (!roles?.includes('admin')) {
		return (
			<div className="flex h-full items-center justify-center p-6">
				<p className="text-sm text-muted-foreground">Organization settings are available to admins only.</p>
			</div>
		)
	}

	return (
		<div className="w-full p-6">
			{/* Page Header */}
			<div className="mb-8">
				<h1 className="text-lg font-bold">Settings</h1>
				<p className="text-md text-muted-foreground">Manage your organization settings and configuration</p>
			</div>

			<OrganizationIdBlock />

			<div className="max-w-5xl space-y-8">
				<OptionalFeaturesSection />
				<Separator />
				<TaskSharingSection />
				<Separator />
				<IntegrationsSection />
				<Separator />
				<OrganizationDomainsSection />
			</div>
		</div>
	)
}
