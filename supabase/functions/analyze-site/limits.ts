// Scan allowance per plan. No imports, so it can be unit tested. The plan is read from the database by analyze-site,
// never from anything the browser sends.
export const SCANS_PER_HOUR = { standard: 10, premium: 30 } as const;
export const scanLimitFor = (plan: unknown): number => (plan === 'premium' ? SCANS_PER_HOUR.premium : SCANS_PER_HOUR.standard);
