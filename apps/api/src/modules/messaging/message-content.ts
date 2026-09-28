/** Encryption context for a message's text, bound to its ID (D-057). Never change it: stored messages use it. */
export const messageContentContext = (messageId: string) => `messages.content:${messageId}`;
