export type NotificationMessage = {
  campaignId: string;
  familyId: string;
};

export function parseNotificationMessage(value: unknown): NotificationMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const campaignId = Reflect.get(value, "campaignId");
  const familyId = Reflect.get(value, "familyId");
  if (typeof campaignId !== "string" || typeof familyId !== "string") return null;
  return { campaignId, familyId };
}
