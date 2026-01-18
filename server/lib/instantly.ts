import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";

interface InstantlyLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  personalization?: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string>;
}

interface InstantlyPushResult {
  success: boolean;
  contactId: string;
  instantlyLeadId?: string;
  error?: string;
}

export function isInstantlyConfigured(): boolean {
  return !!(process.env.INSTANTLY_API_KEY && process.env.INSTANTLY_CAMPAIGN_ID);
}

export function getInstantlyConfig() {
  return {
    apiKey: process.env.INSTANTLY_API_KEY,
    campaignId: process.env.INSTANTLY_CAMPAIGN_ID,
    configured: isInstantlyConfigured(),
  };
}

export async function pushToInstantly(
  contactId: string,
  campaignId?: string
): Promise<InstantlyPushResult> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const targetCampaign = campaignId || process.env.INSTANTLY_CAMPAIGN_ID;

  if (!apiKey) {
    return { success: false, contactId, error: "INSTANTLY_API_KEY not configured" };
  }
  if (!targetCampaign) {
    return { success: false, contactId, error: "No campaign ID provided" };
  }

  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) {
    return { success: false, contactId, error: "Contact not found" };
  }
  if (!contact.email) {
    return { success: false, contactId, error: "Contact has no email" };
  }

  const lead: InstantlyLead = {
    email: contact.email,
    first_name: contact.firstName || undefined,
    last_name: contact.lastName || undefined,
    company_name: undefined,
    phone: contact.phone || undefined,
  };

  try {
    const response = await fetch("https://api.instantly.ai/api/v1/lead/add", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        campaign_id: targetCampaign,
        skip_if_in_workspace: true,
        leads: [lead],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Instantly] Push failed:", response.status, errorText);
      return { success: false, contactId, error: `API error: ${response.status}` };
    }

    const result = await response.json();
    const instantlyLeadId = result.leads?.[0]?.id || `instantly_${Date.now()}`;

    await db.update(contacts).set({
      instantlyLeadId,
      instantlyPushedAt: new Date(),
      instantlyCampaignId: targetCampaign,
    }).where(eq(contacts.id, contactId));

    console.log(`[Instantly] Pushed contact ${contactId} -> ${instantlyLeadId}`);
    return { success: true, contactId, instantlyLeadId };
  } catch (error: any) {
    console.error("[Instantly] Push error:", error);
    return { success: false, contactId, error: error.message };
  }
}

export async function pushBatchToInstantly(
  contactIds: string[],
  campaignId?: string
): Promise<InstantlyPushResult[]> {
  const results: InstantlyPushResult[] = [];
  for (const id of contactIds) {
    const result = await pushToInstantly(id, campaignId);
    results.push(result);
  }
  return results;
}
