import { useId } from 'react'

export type Scope = 'all' | 'unread'

type Props = { value: Scope; onChange: (s: Scope) => void; disabled?: boolean }

/** A two-option switch built from native radio buttons, so arrow keys and screen readers work for free. */
export default function ScopeToggle({ value, onChange, disabled }: Props) {
  const name = useId()
  return (
    <fieldset className="seg" disabled={disabled}>
      <legend className="sr-only">Which mail</legend>
      {(['all', 'unread'] as const).map((s) => (
        <label key={s}>
          <input type="radio" name={name} checked={value === s} onChange={() => onChange(s)} />
          <span>{s === 'all' ? 'All mail' : 'Only unread mail'}</span>
        </label>
      ))}
    </fieldset>
  )
}
