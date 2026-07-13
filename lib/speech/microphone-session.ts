let activeOwner: symbol | null = null;

/** Prevents independent UI surfaces from opening concurrent microphone sessions. */
export function acquireMicrophoneSession(): { owner: symbol; release: () => void } {
  if (activeOwner) {
    throw new Error("O microfone ja esta sendo usado por outra funcao do MrChicken.");
  }

  const owner = Symbol("microphone-session");
  activeOwner = owner;
  return {
    owner,
    release: () => {
      if (activeOwner === owner) activeOwner = null;
    },
  };
}
