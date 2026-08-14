export const INTERACTIVE_TEMPLATE_V2_ALLOWLIST = [
  // P05 adds reviewed production package digests here. This P01 entry covers
  // only the repository-local protocol fixture used by the import gate.
  'fb0e964ed926db0c20bb1706044db6e1c52b5ee65dea7d20ae0a3699611e1490',
] as const

const approvedDigests = new Set<string>(INTERACTIVE_TEMPLATE_V2_ALLOWLIST)

export function isAllowlistedInteractiveTemplateDigest(digest: string): boolean {
  return /^[0-9a-f]{64}$/.test(digest) && approvedDigests.has(digest)
}
