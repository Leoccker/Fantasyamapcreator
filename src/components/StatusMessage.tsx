export interface Status {
  text: string
  error: boolean
}

export function StatusMessage({ status }: { status: Status }) {
  return (
    // Errors interrupt (alert); everything else waits politely.
    <p className={status.error ? 'msg error' : 'msg'} role={status.error ? 'alert' : 'status'} aria-live={status.error ? 'assertive' : 'polite'}>
      {status.text}
    </p>
  )
}
