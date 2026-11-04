import { ParseError } from '../../src/shared/types'
import { ApiError, NetworkError } from './api'

const UPLOAD_MESSAGES: Record<string, string> = {
  no_messages: "We couldn't find any messages in that file. Make sure it is a WhatsApp chat export.",
  no_chat_file: 'That file has no chat in it. Upload the .zip or .txt from WhatsApp.',
  file_too_large: 'That file is too big. Export the chat without media to make it smaller.',
  bad_zip: "That zip file looks damaged. Try exporting the chat again.",
  too_small: 'This chat is too short to read. It needs at least 30 messages from two people.',
}

/** Plain-language message for a failed upload or analysis. */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof ParseError) {
    return UPLOAD_MESSAGES[error.code] ?? 'We could not read that file. Try again with a fresh export.'
  }
  return 'Something went wrong while reading the file. Try again.'
}

/** Plain-language message for a failed call to the server. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) return "We couldn't reach the server. Check your connection and try again."
  if (error instanceof ApiError) {
    switch (error.status) {
      case 413:
        return 'That chat is too large to process. Try a shorter export.'
      case 422:
        return "We couldn't use this chat. Check the file and try again."
      case 429:
        return "You've made a lot of requests. Wait a minute and try again."
      case 503:
        return 'The service is busy right now. Try again in a few minutes.'
      default:
        return 'Something went wrong on our side. Try again.'
    }
  }
  return 'Something went wrong. Try again.'
}
