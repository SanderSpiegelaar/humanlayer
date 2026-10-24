import z from 'zod/v4'

export const MembershipStatusSchema = z.enum(['active', 'inactive'])
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>
