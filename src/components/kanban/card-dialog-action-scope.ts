/**
 * UI callbacks belong to one open card dialog. Issued mutations still finish;
 * only their stale UI effects are ignored after close, unmount or another card.
 */
export function createCardDialogActionScope() {
  let generation = 0;
  let active = false;
  return {
    enter() { active = true; generation += 1; },
    leave() { active = false; generation += 1; },
    capture() {
      const started = generation;
      return () => active && generation === started;
    },
  };
}
