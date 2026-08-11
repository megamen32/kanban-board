export interface BrowserPushSubscription {
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}

interface DeleteResponse {
  ok: boolean;
}

export async function unsubscribeAfterServerDeletion(
  subscription: BrowserPushSubscription | null,
  deleteSubscription: (endpoint?: string) => Promise<DeleteResponse>,
): Promise<void> {
  const response = await deleteSubscription(subscription?.endpoint);
  if (!response.ok) throw new Error('Unable to disable notifications');
  await subscription?.unsubscribe();
}
