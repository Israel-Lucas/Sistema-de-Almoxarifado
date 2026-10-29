(() => {
  const banner = document.createElement("div");
  banner.className = "connection-banner";
  banner.textContent =
    "Sem conexão com o servidor. Algumas ações estão temporariamente indisponíveis.";
  banner.hidden = navigator.onLine;
  document.body.appendChild(banner);
  const errorToast = document.createElement("div");
  errorToast.className = "error-toast";
  errorToast.setAttribute("role", "alert");
  errorToast.hidden = true;
  document.body.appendChild(errorToast);
  let errorTimer;
  const showError = (message) => {
    if (!message) return;
    clearTimeout(errorTimer);
    errorToast.textContent = message;
    errorToast.hidden = false;
    requestAnimationFrame(() => errorToast.classList.add("is-visible"));
    errorTimer = setTimeout(() => {
      errorToast.classList.remove("is-visible");
      setTimeout(() => (errorToast.hidden = true), 180);
    }, 2000);
  };
  document.querySelectorAll(".form-feedback").forEach((feedback) => {
    new MutationObserver(() => {
      const message = feedback.textContent.trim();
      if (!message) return;
      feedback.textContent = "";
      showError(message);
    }).observe(feedback, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  addEventListener("offline", () => {
    banner.hidden = false;
  });
  addEventListener("online", () => {
    banner.hidden = true;
  });
  document.querySelectorAll("dialog form").forEach((form) => {
    form.dataset.dirty = "false";
    form.addEventListener("input", () => {
      form.dataset.dirty = "true";
    });
    form.addEventListener("submit", () => {
      form.dataset.dirty = "false";
    });
  });
  addEventListener("beforeunload", (event) => {
    const dirty = [...document.querySelectorAll("dialog[open] form")].some(
      (form) => form.dataset.dirty === "true",
    );
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  addEventListener("unhandledrejection", (event) => {
    console.error("Erro não tratado:", event.reason);
  });
})();
