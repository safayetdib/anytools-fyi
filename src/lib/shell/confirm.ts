export interface ConfirmOptions {
  question: string;
  yes: string;
  no: string;
  // Where focus goes back to if the visitor keeps things as they are.
  returnFocus?: HTMLElement | null;
}

// Shows a ShellConfirm card and resolves true only if the visitor chooses yes.
export function createConfirm(card: HTMLElement) {
  const question = card.querySelector("[data-confirm-question]") as HTMLElement;
  const yes = card.querySelector('[data-confirm="yes"]') as HTMLButtonElement;
  const no = card.querySelector('[data-confirm="no"]') as HTMLButtonElement;
  let settle: ((answer: boolean) => void) | null = null;
  let returnFocus: HTMLElement | null = null;

  function finish(answer: boolean, restoreFocus: boolean) {
    if (card.hidden) return;
    card.hidden = true;
    const done = settle;
    settle = null;
    if (!answer && restoreFocus) returnFocus?.focus();
    done?.(answer);
  }

  yes.addEventListener("click", () => finish(true, false));
  no.addEventListener("click", () => finish(false, true));
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish(false, true);
  });

  return {
    ask(options: ConfirmOptions): Promise<boolean> {
      finish(false, false);
      question.textContent = options.question;
      yes.textContent = options.yes;
      no.textContent = options.no;
      returnFocus = options.returnFocus ?? null;
      card.hidden = false;
      card.scrollIntoView({
        block: "nearest",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      // The safe choice gets focus, so an accidental Enter keeps everything.
      no.focus();
      return new Promise((resolve) => (settle = resolve));
    },

    dismiss() {
      finish(false, false);
    },
  };
}
