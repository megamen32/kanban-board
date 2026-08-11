declare module 'web-push' {
  interface WebPushSubscription {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  }

  interface WebPushClient {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(subscription: WebPushSubscription, payload?: string, options?: { TTL?: number }): Promise<unknown>;
  }

  const webPush: WebPushClient;
  export default webPush;
}
