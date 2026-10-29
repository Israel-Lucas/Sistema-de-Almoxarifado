const form = document.querySelector("#login-form");
const username = document.querySelector("#username");
const password = document.querySelector("#password");
const togglePassword = document.querySelector("#toggle-password");
const formMessage = document.querySelector("#form-message");
const submitButton = form.querySelector("button[type='submit']");

togglePassword.addEventListener("click", () => {
  const hidden = password.type === "password";
  password.type = hidden ? "text" : "password";
  togglePassword.setAttribute(
    "aria-label",
    hidden ? "Ocultar senha" : "Exibir senha",
  );
  togglePassword.setAttribute(
    "title",
    hidden ? "Ocultar senha" : "Exibir senha",
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formMessage.classList.remove("is-visible");
  if (!username.value.trim() || !password.value) {
    formMessage.textContent = "Preencha o usuário e a senha para continuar.";
    formMessage.classList.add("is-visible");
    (!username.value.trim() ? username : password).focus();
    return;
  }
  submitButton.disabled = true;
  try {
    await Api.post("/auth/login", {
      username: username.value.trim(),
      password: password.value,
    });
    window.location.assign("dashboard.html");
  } catch (error) {
    formMessage.textContent = error.message;
    formMessage.classList.add("is-visible");
    password.select();
  } finally {
    submitButton.disabled = false;
  }
});
