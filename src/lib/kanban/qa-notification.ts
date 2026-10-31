/** Dedicated synthetic test identities must not wake real Notice recipients. */
export function isAutomatedQaAccount(owner: string | undefined): boolean {
  return owner !== undefined && ['qa_exmanager_a', 'qa_exmanager_b', 'testlogin']
    .includes(owner.trim().toLowerCase());
}
