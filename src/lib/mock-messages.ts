export const MOCK_THREADS = [
  {
    id: 't1',
    bookingRef: 'RNT-A3F9KX',
    equipment: 'Sony A7 IV',
    otherUser: { name: 'Maria Santos', initial: 'M', isHost: false },
    lastMessage: 'Hi! Will the battery grip be included?',
    lastAt: '2026-06-30T10:23:00Z',
    unread: 2,
    messages: [
      { id: 'm1', senderId: 'them', text: 'Hi! I wanted to confirm my booking for July 2–5.', at: '2026-06-29T09:00:00Z' },
      { id: 'm2', senderId: 'me',   text: "Hi Maria! Yes, your booking is confirmed. I'll have everything ready for you.", at: '2026-06-29T09:15:00Z' },
      { id: 'm3', senderId: 'them', text: 'Perfect! One question — will the battery grip be included?', at: '2026-06-30T10:23:00Z' },
    ],
  },
  {
    id: 't2',
    bookingRef: 'RNT-B7X2QT',
    equipment: 'Canon RF 70-200mm',
    otherUser: { name: 'John dela Cruz', initial: 'J', isHost: false },
    lastMessage: "Sounds good, I'll confirm by tonight.",
    lastAt: '2026-06-30T08:05:00Z',
    unread: 0,
    messages: [
      { id: 'm4', senderId: 'them', text: 'Hello! Is the lens available for July 6–7?', at: '2026-06-29T14:00:00Z' },
      { id: 'm5', senderId: 'me',   text: "Yes it's available! Go ahead and book via the app.", at: '2026-06-29T14:30:00Z' },
      { id: 'm6', senderId: 'them', text: "Sounds good, I'll confirm by tonight.", at: '2026-06-30T08:05:00Z' },
    ],
  },
  {
    id: 't3',
    bookingRef: 'RNT-C1M5PW',
    equipment: 'Sony FX3',
    otherUser: { name: 'Trish Mendoza', initial: 'T', isHost: false },
    lastMessage: 'What time can I pick it up?',
    lastAt: '2026-06-29T18:45:00Z',
    unread: 1,
    messages: [
      { id: 'm7', senderId: 'them', text: 'Hi! Booking confirmed for July 10–14. What time can I pick it up?', at: '2026-06-29T18:45:00Z' },
    ],
  },
  {
    id: 't4',
    bookingRef: 'RNT-D4K8LN',
    equipment: 'iPhone 16 Pro Max',
    otherUser: { name: 'Carlo Santos', initial: 'C', isHost: true },
    lastMessage: 'Thanks for the review! Hope to host you again.',
    lastAt: '2026-06-28T20:00:00Z',
    unread: 0,
    messages: [
      { id: 'm8', senderId: 'me',   text: 'Thanks for the smooth transaction! Phone was in perfect condition.', at: '2026-06-28T19:30:00Z' },
      { id: 'm9', senderId: 'them', text: 'Thanks for the review! Hope to host you again.', at: '2026-06-28T20:00:00Z' },
    ],
  },
]

export type Thread = typeof MOCK_THREADS[0]
export type Message = typeof MOCK_THREADS[0]['messages'][0]
