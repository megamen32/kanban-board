import { describe, expect, it } from 'vitest';

import {
  ASSIGNEE_AUTHORIZATION_NOTICE,
  createFailureMessage,
  isAssigneeAuthorizationFailure,
} from './create-form-errors';

describe('create form failure copy', () => {
  it('recognises the owner-authorization refusal for assignees', () => {
    expect(isAssigneeAuthorizationFailure('Подтвердите переназначение ответственных перед сохранением.')).toBe(true);
  });

  it('does not treat unrelated failures as assignee refusals', () => {
    expect(isAssigneeAuthorizationFailure('Сервер временно недоступен. Введённые данные не удалены — попробуйте ещё раз.')).toBe(false);
    expect(isAssigneeAuthorizationFailure('Войдите снова и повторите сохранение. Введённые данные не удалены.')).toBe(false);
  });

  it('explains the assignee policy next to the server refusal', () => {
    const message = createFailureMessage('Подтвердите переназначение ответственных перед сохранением.', true);
    expect(message).toContain('Подтвердите переназначение ответственных');
    expect(message).toContain(ASSIGNEE_AUTHORIZATION_NOTICE);
  });

  it('keeps the plain server message when no assignee was requested', () => {
    expect(createFailureMessage('Подтвердите переназначение ответственных перед сохранением.', false))
      .toBe('Подтвердите переназначение ответственных перед сохранением.');
  });

  it('keeps unrelated failures unchanged', () => {
    const message = 'Сервер временно недоступен. Введённые данные не удалены — попробуйте ещё раз.';
    expect(createFailureMessage(message, true)).toBe(message);
  });
});
