// PDF passwords longer than this are cut short by some readers.
export const MAX_PASSWORD = 127;

// What's wrong with the passwords typed, if anything.
export function passwordProblem(password: string, repeat: string): "empty" | "long" | "mismatch" | null {
  if (!password) return "empty";
  if (password.length > MAX_PASSWORD) return "long";
  if (password !== repeat) return "mismatch";
  return null;
}
