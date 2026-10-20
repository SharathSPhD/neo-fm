/**
 * Legal contact details published on /grievance and in the terms.
 * IT Rules 2021 (Rule 3(2)) require the grievance officer's name and contact to be published, so S sets
 * these in Vercel env (NEXT_PUBLIC_*) before launch; until then the pages show the role and the shared inbox.
 */
export const LEGAL_CONTACT = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY || "Technektar",
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "",
  grievanceOfficerName: process.env.NEXT_PUBLIC_GRIEVANCE_OFFICER_NAME || "",
  website: process.env.NEXT_PUBLIC_LEGAL_WEBSITE || "https://www.technektar.com/",
  email: process.env.NEXT_PUBLIC_GRIEVANCE_EMAIL || "info@technektar.com",
} as const;

/** Statutory clocks we promise on /grievance; keep the page and any ops runbook in step with these. */
export const GRIEVANCE_SLA = { acknowledgeHours: 24, resolveDays: 15, urgentRemovalHours: 24 } as const;
