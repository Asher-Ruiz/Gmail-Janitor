import type { ReactNode } from 'react'

/**
 * Lets text fade and grow into place instead of popping in. The content stays mounted so it can fade out
 * too, and while hidden it is removed from the accessibility tree.
 */
export default function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="reveal" data-open={show} aria-hidden={!show}>
      <div>{children}</div>
    </div>
  )
}
