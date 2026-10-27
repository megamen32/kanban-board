/**
 * Presentation-only helpers for the create-card form.
 *
 * The server keeps the owner-authorization decision; these helpers only make
 * that decision understandable next to the field and inside the alert.
 */

/** Explains that only the board owner can authorize an assignee. */
export const ASSIGNEE_AUTHORIZATION_NOTICE =
  'Назначить ответственного может только владелец доски. Оставьте поле пустым — задача создастся без исполнителя, а владелец назначит его позже.';

/**
 * Detects the server refusal that asks for owner authorization of assignees.
 *
 * @param message Human-readable message produced by the board mutation layer.
 * @returns True when the refusal is about assigning other people.
 */
export function isAssigneeAuthorizationFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes('ответственн')) return false;
  return normalized.includes('подтвердите') || normalized.includes('владел') || normalized.includes('авторизац');
}

/**
 * Builds the visible failure text while the typed values stay in the form.
 *
 * @param message Human-readable server message.
 * @param hadAssignees Whether the request carried at least one assignee.
 * @returns The message to show, extended with the assignee policy when relevant.
 */
export function createFailureMessage(message: string, hadAssignees: boolean): string {
  if (hadAssignees && isAssigneeAuthorizationFailure(message)) return `${message} ${ASSIGNEE_AUTHORIZATION_NOTICE}`;
  return message;
}
