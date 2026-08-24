// ---------------------------------------------------------------------------
// send-whatsapp — retired
//
// WhatsApp cannot be sent from an application without Meta's WhatsApp Business
// API or a reseller such as Twilio, and this family uses neither. Two things
// replaced it:
//
//   * send-push       delivers notifications to phones directly, free, with no
//                     third party and no 24-hour messaging window
//   * ShareButton     puts a one-tap "open WhatsApp with this message ready"
//                     link on guests, tasks, the menu and the shopping list,
//                     for the times something should go to the family group
//
// The slot is kept so an old caller gets a clear 410 rather than a 404. Safe
// to delete from the dashboard.
// ---------------------------------------------------------------------------
Deno.serve(() =>
  new Response(
    JSON.stringify({ retired: true, use: 'send-push' }),
    { status: 410, headers: { 'Content-Type': 'application/json' } },
  )
)
