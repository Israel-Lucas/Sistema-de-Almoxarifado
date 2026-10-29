(async () => {
  let logs = [],
    references = {},
    pageInfo = { page: 1, pages: 1, total: 0 };
  const body = document.querySelector("#logs-table-body"),
    empty = document.querySelector("#logs-empty"),
    search = document.querySelector("#logs-search"),
    method = document.querySelector("#logs-method");
  const maps = {};
  const byId = (collection, id) => maps[collection]?.get(id);
  const idFromPath = (resource) => resource.split("/").filter(Boolean).at(-1);
  const describe = (log) => {
    const details = log.details || {},
      resource = log.resource;
    if (resource === "/api/inventory/change") {
      const product = byId("products", details.productId)?.name || "item";
      const parts = [];
      if (details.removal)
        parts.push(
          `removeu ${details.removal.quantity} de ${byId("units", details.removal.unitId)?.name || "uma unidade"}`,
        );
      if (details.addition)
        parts.push(
          `acrescentou ${details.addition.quantity} em ${byId("units", details.addition.unitId)?.name || "uma unidade"}`,
        );
      return `Alterou o estoque de ${product}: ${parts.join(" e ")}.`;
    }
    if (resource === "/api/products" && log.method === "POST")
      return `Cadastrou o item ${details.name}, modelo ${details.model}, com estoque inicial de ${details.initialQuantity}.`;
    if (resource.startsWith("/api/products/") && log.method === "DELETE")
      return `Excluiu o item ${byId("products", idFromPath(resource))?.name || "cadastrado"}.`;
    if (resource === "/api/requests/batch" && log.method === "POST")
      return `Enviou um pedido agrupado com ${details.items?.length || 0} produto(s).`;
    if (resource === "/api/requests/equipment-set" && log.method === "POST")
      return `Solicitou ${details.quantity} conjunto(s) de equipamentos, com os componentes registrados separadamente.`;
    if (resource === "/api/returns" && log.method === "POST")
      return `Enviou uma devolução com ${details.items?.length || 0} item(ns) para a Matriz.`;
    if (/^\/api\/returns\/[^/]+\/receive$/.test(resource))
      return "Confirmou o recebimento de uma devolução e atualizou os estoques.";
    if (/^\/api\/returns\/[^/]+\/cancel$/.test(resource))
      return "Cancelou uma devolução pendente e registrou o motivo.";
    if (resource === "/api/equipment-sets/builder" && log.method === "POST")
      return `Cadastrou o conjunto de equipamentos ${details.name} com ${details.components?.length || 0} componente(s).`;
    if (
      /^\/api\/equipment-sets\/[^/]+\/builder$/.test(resource) &&
      log.method === "PUT"
    )
      return `Atualizou a composição do conjunto de equipamentos ${details.name}.`;
    if (
      /^\/api\/equipment-sets\/[^/]+$/.test(resource) &&
      log.method === "DELETE"
    )
      return "Excluiu um kit do catálogo, preservando seus itens e históricos.";
    const groupMatch = resource.match(
      /^\/api\/requests\/groups\/[^/]+\/(decision|deliver|cancel)$/,
    );
    if (groupMatch) {
      if (groupMatch[1] === "decision")
        return `Analisou um pedido agrupado com ${details.items?.length || 0} produto(s).`;
      if (groupMatch[1] === "deliver")
        return "Marcou todos os itens aprovados de um pedido como entregues.";
      return "Cancelou um pedido ainda não analisado e registrou o motivo.";
    }
    const requestMatch = resource.match(
      /^\/api\/requests\/([^/]+)\/(decision|deliver)$/,
    );
    if (requestMatch) {
      const number = byId("requests", requestMatch[1])?.request_number;
      if (requestMatch[2] === "deliver")
        return `Marcou o pedido ${number ? `nº ${number}` : "selecionado"} como entregue.`;
      const decisions = {
        APPROVE: "aprovou",
        PARTIAL: "aprovou parcialmente",
        REJECT: "recusou",
      };
      return `${decisions[details.decision] || "Analisou"} o pedido ${number ? `nº ${number}` : "selecionado"}${details.approvedQuantity ? ` em ${details.approvedQuantity} unidade(s)` : ""}.`;
    }
    if (resource === "/api/units" && log.method === "POST")
      return `Cadastrou a unidade ${details.name}.`;
    if (resource.startsWith("/api/units/"))
      return `${log.method === "DELETE" ? "Excluiu" : "Alterou"} a unidade ${byId("units", idFromPath(resource))?.name || "selecionada"}.`;
    if (resource === "/api/types" && log.method === "POST")
      return `Cadastrou o tipo de produto ${details.name}.`;
    if (resource.startsWith("/api/types/"))
      return `${log.method === "DELETE" ? "Excluiu" : "Alterou"} o tipo ${byId("types", idFromPath(resource))?.name || "selecionado"}.`;
    if (resource === "/api/users" && log.method === "POST")
      return `Cadastrou o usuário ${details.name} (${details.username}).`;
    if (resource.startsWith("/api/users/"))
      return `${log.method === "DELETE" ? "Excluiu" : "Alterou"} o usuário ${byId("users", idFromPath(resource))?.name || "selecionado"}.`;
    if (resource === "/api/auth/login") return "Entrou no sistema.";
    return "Realizou uma operação administrativa no sistema.";
  };
  const labels = {
    POST: "Operação",
    PATCH: "Alteração",
    PUT: "Atualização",
    DELETE: "Exclusão",
  };
  const render = () => {
    logs.forEach((log) => {
      log.description = describe(log);
    });
    const query = search.value.trim().toLocaleUpperCase("pt-BR"),
      filtered = logs.filter(
        (log) =>
          (!method.value || log.method === method.value) &&
          `${log.user_name || ""} ${log.username || ""} ${log.unit_name || ""} ${log.description}`
            .toLocaleUpperCase("pt-BR")
            .includes(query),
      );
    body.replaceChildren();
    empty.hidden = filtered.length > 0;
    filtered.forEach((log) => {
      const row = document.createElement("tr");
      const values = [
        new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "medium",
        }).format(new Date(log.created_at)),
        log.user_name || "Sistema",
        log.unit_name || "—",
      ];
      values.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      const type = document.createElement("td"),
        badge = document.createElement("span");
      badge.className = `log-action log-action--${log.method.toLowerCase()}`;
      badge.textContent = labels[log.method] || "Atividade";
      type.appendChild(badge);
      const activity = document.createElement("td");
      activity.className = "log-description";
      activity.textContent = log.description;
      row.append(type, activity);
      body.appendChild(row);
    });
    document.querySelector("#logs-page-info").textContent =
      `Página ${pageInfo.page} de ${pageInfo.pages} · ${pageInfo.total} registro(s)`;
    document.querySelector("#logs-prev").disabled = pageInfo.page <= 1;
    document.querySelector("#logs-next").disabled =
      pageInfo.page >= pageInfo.pages;
  };
  const load = async () => {
    const query = new URLSearchParams({
      page: pageInfo.page,
      limit: 25,
      search: search.value.trim(),
      method: method.value,
    });
    ({
      logs,
      references,
      pagination: pageInfo,
    } = await Api.get(`/audit?${query}`));
    Object.entries(references).forEach(([name, items]) => {
      maps[name] = new Map(items.map((item) => [item.id, item]));
    });
    render();
  };
  try {
    const { user } = await Api.get("/auth/me");
    if (user.role !== "MASTER") {
      location.replace("dashboard.html");
      return;
    }
    document.querySelector("#session-user-name").textContent = user.name;
    document.querySelector("#session-user-unit").textContent = user.unitName;
    await load();
    let timer;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        pageInfo.page = 1;
        load();
      }, 300);
    });
    method.addEventListener("change", () => {
      pageInfo.page = 1;
      load();
    });
    document.querySelector("#logs-prev").onclick = () => {
      pageInfo.page--;
      load();
    };
    document.querySelector("#logs-next").onclick = () => {
      pageInfo.page++;
      load();
    };
    document.querySelector("#export-logs").onclick = () => {
      const query = new URLSearchParams({
        search: search.value.trim(),
        method: method.value,
      });
      location.href = `/api/exports/audit?${query}`;
    };
    document.querySelector("#export-movements").onclick = () => {
      location.href = "/api/exports/movements";
    };
    document
      .querySelector("#logout-button")
      .addEventListener("click", async () => {
        await Api.post("/auth/logout", {});
        location.replace("login.html");
      });
  } catch (error) {
    empty.hidden = false;
    empty.querySelector("strong").textContent =
      "Não foi possível carregar os registros";
    empty.querySelector("p").textContent = error.message;
  }
})();
