import { shareToWhatsApp } from '../lib/whatsapp'
import { Button } from './ui'

/**
 * One tap to WhatsApp with the message already written.
 *
 * Nothing is sent automatically — WhatsApp opens with the text ready and you
 * choose the chat, which is how the family group gets the update without any
 * business account or per-message cost.
 */
export function ShareButton({
  text,
  phone,
  label = 'WhatsApp',
  variant = 'secondary',
  size,
  className = '',
}: {
  text: string | (() => string)
  phone?: string | null
  label?: string
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={(event) => {
        event.stopPropagation()
        shareToWhatsApp(typeof text === 'function' ? text() : text, phone)
      }}
      title="Open WhatsApp with this message ready to send"
    >
      <span aria-hidden>💬</span> {label}
    </Button>
  )
}
