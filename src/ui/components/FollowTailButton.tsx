/**
 * The "you have scrolled back" control shared by both terminal tabs (OP-27,
 * OP-44). Floats over the history rather than sitting under it — a control that
 * appeared in the flow would resize the output the moment the player scrolled,
 * which moves the reading position again.
 */
export function FollowTailButton({ pending, onClick }: { pending: number; onClick: () => void }) {
  return (
    <button type="button" className="terminal-follow" onClick={onClick}>
      {pending > 0 ? `${pending} NEW LINE${pending === 1 ? '' : 'S'} BELOW` : 'SCROLLED BACK'}{' '}
      &darr;
    </button>
  );
}
