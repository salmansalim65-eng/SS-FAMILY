import { fmtDate, qty } from './format'
import type { Guest, MenuItem, ConsolidatedItem, Task } from './types'

/**
 * WhatsApp share links.
 *
 * An app cannot *send* a WhatsApp message — that needs Meta's Business API.
 * What it can do is hand WhatsApp a ready-written message and let you pick the
 * chat, which for a family group is one tap and no monthly bill.
 *
 * `https://wa.me/?text=…` opens the share sheet with the text filled in;
 * adding a number opens that chat directly.
 */
export function shareUrl(text: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/[^\d]/g, '')
  const encoded = encodeURIComponent(text)
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}

/** Opens WhatsApp in a new tab, or the app itself on a phone. */
export function shareToWhatsApp(text: string, phone?: string | null): void {
  window.open(shareUrl(text, phone), '_blank', 'noopener,noreferrer')
}

// ---------------------------------------------------------------------------
// Message bodies. Plain text on purpose: WhatsApp only understands *bold* and
// _italic_, and a message that has to survive a small screen reads better as
// short lines than as a table.
// ---------------------------------------------------------------------------

export function guestMessage(guest: Guest): string {
  const lines = [`*${guest.name}*`]

  if (guest.guest_type === 'dinner') {
    lines.push(
      `🍽️ Dinner on ${fmtDate(guest.arrival_date)}` +
        (guest.event_time ? ` at ${guest.event_time.slice(0, 5)}` : ''),
    )
  } else {
    lines.push(`🧳 Staying ${fmtDate(guest.arrival_date)}` +
      (guest.departure_date ? ` → ${fmtDate(guest.departure_date)}` : ''))
    if (guest.room) lines.push(`🛏️ Room: ${guest.room}`)
  }

  lines.push(`👥 ${guest.total_guests} guest(s) — ${guest.male_count} male, ${guest.female_count} female`)
  if (guest.relationship) lines.push(`🤝 ${guest.relationship}`)
  if (guest.origin_city) lines.push(`📍 From ${guest.origin_city}`)
  if (guest.special_needs) lines.push(`📝 ${guest.special_needs}`)

  return lines.join('\n')
}

export function shoppingMessage(items: ConsolidatedItem[]): string {
  if (items.length === 0) return 'The shopping list is empty.'

  const byCategory = new Map<string, ConsolidatedItem[]>()
  for (const item of items) {
    const key = item.category ?? 'Other'
    byCategory.set(key, [...(byCategory.get(key) ?? []), item])
  }

  const lines = ['*Shopping list*', '']
  for (const [category, group] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`*${category}*`)
    for (const item of group) {
      lines.push(`• ${item.item_name} — ${qty(item.total_quantity)} ${item.unit}`)
    }
    lines.push('')
  }
  lines.push(`_${items.length} item(s) · SS Family_`)
  return lines.join('\n').trim()
}

export function menuMessage(items: MenuItem[], serveDate?: string | null): string {
  if (items.length === 0) return 'No dishes planned yet.'

  const lines = [serveDate ? `*Menu — ${fmtDate(serveDate)}*` : '*Menu*', '']
  for (const item of items) {
    const how = item.homemade_or_outside === 'outside' ? '🛍️ ordered' : '🍳 homemade'
    lines.push(`• ${item.dish_name} — ${qty(item.quantity)} ${item.unit ?? 'serving'} (${how})`)
  }
  lines.push('', '_SS Family_')
  return lines.join('\n')
}

export function taskMessage(task: Task, assigneeName?: string | null): string {
  const lines = [`*${task.title}*`]
  if (task.description) lines.push(task.description)
  if (task.due_date) lines.push(`📅 Due ${fmtDate(task.due_date)}`)
  lines.push(`⚡ Priority: ${task.priority}`)
  if (assigneeName) lines.push(`👤 ${assigneeName}`)
  return lines.join('\n')
}
