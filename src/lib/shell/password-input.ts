// Makes the show button of a password box (see PasswordInput.astro) switch between dots and the typed text.
export function wireShowButton(button: HTMLButtonElement) {
  const input = button.parentElement?.querySelector("input") as HTMLInputElement;
  button.addEventListener("click", () => {
    const shown = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(shown));
    button.setAttribute("aria-label", (shown ? button.dataset.labelHide : button.dataset.labelShow) ?? "");
    input.type = shown ? "text" : "password";
  });
}

// A rough guide to how hard a password is to guess: 1 weak, 2 fair, 3 strong.
export function strengthOf(password: string): 0 | 1 | 2 | 3 {
  if (!password) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
  const score = password.length + kinds * 2;
  return score >= 18 ? 3 : score >= 12 ? 2 : 1;
}
