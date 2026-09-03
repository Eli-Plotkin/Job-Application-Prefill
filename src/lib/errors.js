// Rewrites raw errors (Anthropic API errors, network failures, malformed model
// output, extension messaging failures) into plain-language text a non-technical
// user can act on. Used everywhere an error reaches the in-page overlay, so a
// dropped connection or a 429 never surfaces as a raw exception message.
export function humanError(e) {
  const msg = String((e && e.message) || e || "");

  if (/no api key set/i.test(msg)) {
    return "No API key set. Open the Apply Assistant dashboard to add one.";
  }
  if (/401|authentication_error|invalid x-api-key/i.test(msg)) {
    return "Your Anthropic API key was rejected. Check it in the dashboard — it may be missing, expired, or mistyped.";
  }
  if (/403|permission_denied/i.test(msg)) {
    return "Your Anthropic API key doesn't have permission for this. Check its access in your Anthropic console.";
  }
  if (/429|rate_limit_error/i.test(msg)) {
    return "Anthropic is rate-limiting this key — you're sending requests too quickly, or you're out of credit. Wait a moment and try again, or check your usage at console.anthropic.com.";
  }
  if (/5\d\d|overloaded_error|internal_server_error/i.test(msg)) {
    return "Anthropic's API is temporarily unavailable. Try again in a moment.";
  }
  if (/failed to fetch|networkerror|econnrefused|connection error/i.test(msg)) {
    return "Couldn't reach the Anthropic API — check your internet connection and try again.";
  }
  if (/no json object found|unterminated json object|unexpected token.*json|json\.parse/i.test(msg)) {
    return "Got an unreadable response from the AI model. Try Re-scan — if it keeps happening, try a different match model in the dashboard.";
  }
  if (/could not establish connection|no response from the background worker|receiving end does not exist/i.test(msg)) {
    return "Lost connection to the extension. Reload this page and try again.";
  }
  if (/password|encrypted/i.test(msg) && /pdf/i.test(msg)) {
    return "That PDF is password-protected — remove the password and try uploading it again.";
  }
  if (/invalid pdf|pdf.*(corrupt|structure)/i.test(msg)) {
    return "That file doesn't look like a valid PDF. Try re-exporting it or uploading a different format.";
  }

  return msg;
}
