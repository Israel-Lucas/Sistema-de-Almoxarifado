const pendingMutations = new Set();
window.Api = Object.freeze({
  async request(path, options = {}) {
    const method = options.method || "GET",
      mutation = !["GET", "HEAD", "OPTIONS"].includes(method),
      key = `${method}:${path}`;
    if (mutation && pendingMutations.has(key)) {
      const error = new Error("Esta operação já está sendo processada.");
      error.code = "OPERATION_IN_PROGRESS";
      throw error;
    }
    if (mutation) pendingMutations.add(key);
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      if (response.status === 401 && path !== "/auth/login") {
        window.location.replace("/html/login.html");
        throw new Error("Sua sessão expirou. Entre novamente.");
      }
      if (response.status === 204) return null;
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          body.message || "Não foi possível concluir a operação.",
        );
        error.code = body.error;
        error.fields = body.fields || body.details || {};
        error.details = error.fields;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError")
        throw new Error(
          "O servidor demorou para responder. Verifique a conexão e tente novamente.",
        );
      if (error instanceof TypeError)
        throw new Error(
          "Servidor indisponível. Verifique sua conexão com a rede.",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      if (mutation) pendingMutations.delete(key);
    }
  },
  get(path) {
    return this.request(path);
  },
  post(path, data) {
    return this.request(path, { method: "POST", body: JSON.stringify(data) });
  },
  put(path, data) {
    return this.request(path, { method: "PUT", body: JSON.stringify(data) });
  },
  patch(path, data) {
    return this.request(path, { method: "PATCH", body: JSON.stringify(data) });
  },
  delete(path, data) {
    return this.request(path, { method: "DELETE", body: JSON.stringify(data) });
  },
});
