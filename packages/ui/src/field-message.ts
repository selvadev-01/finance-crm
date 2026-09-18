/**
 * Validation messages are written either to follow the field's label ("is
 * already in use", "must be after 1 Sep 2026") or to stand alone ("a reason
 * is required", "say what is wrong"). A predicate gets the label in front;
 * anything else is shown as its own sentence. Used for both the browser's
 * own checks and the API's `400` details, so they read alike.
 */
const PREDICATE =
  /^(is|are|was|has|have|must|cannot|can|should|does|adds|already|appears)\b/;

export function fieldMessage(label: string, issue: string): string {
  const text = issue.trim();
  const sentence = PREDICATE.test(text)
    ? `${label} ${text}`
    : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Zod's built-in messages are written for developers ("Too small: expected
 * string to have >=1 characters"). The ones a person meets most — an empty
 * required field, a missing choice — are reworded here; a contract's own
 * message is kept.
 */
export function validationMessage(
  label: string,
  issue: { type?: string; message?: string },
): string {
  const message = issue.message ?? "";
  const empty =
    (issue.type === "too_small" &&
      /(>=|at least )1 (character|item)/.test(message)) ||
    (issue.type === "invalid_type" &&
      /received undefined|received null/.test(message));
  if (empty) return `${label} is required.`;
  if (/^(Too small|Too big|Invalid)\b/.test(message))
    return `Check ${label.toLowerCase()}.`;
  return fieldMessage(label, message || "is not valid");
}
