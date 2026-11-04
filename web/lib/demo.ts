import type { PersonaId } from '../../src/shared/types'

/**
 * Made-up demo reports for the landing page. None of this is from a real chat.
 */
export interface DemoChat {
  id: string
  emoji: string
  label: string
  persona: PersonaId
  title: string
  lines: [string, string, string]
}

export const DEMO_CHATS: DemoChat[] = [
  {
    id: 'the-boys',
    emoji: '🍻',
    label: 'The Boys',
    persona: 'brandon',
    title: 'The Boys: the official report on a plan that never happened',
    lines: [
      'Dan has said "I will be there" 14 times this year and shown up twice.',
      'Sam is the only one who has ever paid the bill on the first try.',
      'Verdict: the group chat is the only place this friendship still happens.',
    ],
  },
  {
    id: 'uni-crew',
    emoji: '📚',
    label: 'Uni crew',
    persona: 'clara',
    title: 'Uni crew: a warm, slightly alarming look at deadline season',
    lines: [
      'Most messages land between 11pm and 2am, always in the week before a deadline.',
      'Priya starts every big thread, and everyone quietly replies to her first.',
      'The shared study-room jokes come back every term. Keep them, they work.',
    ],
  },
  {
    id: 'family',
    emoji: '🏠',
    label: 'Family',
    persona: 'diego',
    title: 'Family: a practical plan for the next group dinner',
    lines: [
      'Nobody answers the dinner question, so the date gets picked by default.',
      'Step one: give one person the job of booking, and say so in the chat.',
      'Step two: send the reminder the day before, with the address this time.',
    ],
  },
  {
    id: 'work-eng',
    emoji: '💻',
    label: 'Work — eng',
    persona: 'brandon',
    title: 'Work, eng: the release that was "almost done" for three weeks',
    lines: [
      'The word "quick" appears 31 times, and the average quick task took four days.',
      'Ola reviews every pull request within an hour, which nobody has thanked her for.',
      'Verdict: ship on Thursday, or stop saying Thursday.',
    ],
  },
  {
    id: 'book-club',
    emoji: '📖',
    label: 'Book club',
    persona: 'clara',
    title: 'Book club: who finished the book, and who just came for the snacks',
    lines: [
      'Half the group has opinions about chapter three and nobody has read chapter four.',
      'Maya posts the best quotes, and the thread gets three times the replies.',
      'The snack rota is the most consistent thing this group has ever done.',
    ],
  },
  {
    id: 'running-club',
    emoji: '🏃',
    label: 'Running club',
    persona: 'diego',
    title: 'Running club: the plan for finishing the race you signed up for',
    lines: [
      'Messages spike every Sunday morning, then go quiet until the next long run.',
      'Two members post their splits every week; the rest post photos of coffee.',
      'Step one: pick a fixed meeting point so the group stops arriving at different corners.',
    ],
  },
  {
    id: 'flatmates',
    emoji: '🧹',
    label: 'Flatmates',
    persona: 'brandon',
    title: 'Flatmates: a full audit of who did the bins this month',
    lines: [
      'The bins have been "sorted" in the chat 19 times and taken out by one person.',
      'Ruth has sent the most messages about the boiler, and has never once fixed it.',
      'Verdict: a rota on the fridge beats a rota in the chat, and everyone knows it.',
    ],
  },
  {
    id: 'five-a-side',
    emoji: '⚽',
    label: 'Five-a-side',
    persona: 'diego',
    title: 'Five-a-side: a coaching plan for a team that talks more than it runs',
    lines: [
      'Most messages are about who is or is not coming, sent after kick-off has started.',
      'Step one: a fixed time, a fixed pitch, and a yes-or-no deadline on Friday.',
      'Step two: give the goalkeeper a job, so someone is always accountable for the score.',
    ],
  },
  {
    id: 'band',
    emoji: '🎸',
    label: 'Band practice',
    persona: 'clara',
    title: 'Band practice: love, drumming and the setlist that never changes',
    lines: [
      'Every rehearsal thread starts with the same song and ends with a new one.',
      'The drummer apologises more than anyone, and is also the most reliable member.',
      'Keep going: the chat has more ideas per week than most albums do.',
    ],
  },
]
