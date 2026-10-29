(async () => {
  const $ = (s) => document.querySelector(s);
  let user,
    requests = [],
    page = { page: 1, pages: 1, total: 0 },
    types = [];
  const actionDialog = $("#purchase-action-dialog"),
    receiveDialog = $("#purchase-receive-dialog");
  const labels = {
    SOLICITADO: "Solicitado",
    APROVADO: "Aprovado",
    RECUSADO: "Recusado",
    EM_COMPRA: "Em compra",
    RECEBIDO: "Recebido",
  };
  const params = () =>
    new URLSearchParams({
      page: page.page,
      limit: 15,
      search: $("#purchase-search").value.trim(),
      status: $("#purchase-status").value,
    });
  const button = (text, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "review-button";
    b.textContent = text;
    b.onclick = fn;
    return b;
  };
  const load = async () => {
    const data = await Api.get(`/purchase-requests?${params()}`);
    requests = data.requests;
    page = data.pagination;
    render();
  };
  const openAction = (r, mode) => {
    $("#purchase-action-form").reset();
    $("#purchase-action-id").value = r.id;
    $("#purchase-action-mode").value = mode;
    $("#purchase-action-name").textContent = `${r.item_name} — ${r.unit_name}`;
    $("#purchase-action-title").textContent =
      mode === "decision" ? "Analisar solicitação" : "Registrar compra";
    $("#purchase-decision-field").hidden = mode !== "decision";
    $("#purchase-action-message").textContent = "";
    actionDialog.showModal();
  };
  const openReceive = (r) => {
    $("#purchase-receive-form").reset();
    $("#purchase-receive-id").value = r.id;
    $("#purchase-receive-name").textContent =
      `Solicitação #${r.request_number}`;
    $("#receive-name").value = r.item_name;
    $("#receive-quantity").value = r.quantity;
    $("#receive-type").replaceChildren(new Option("Selecione", ""));
    types
      .filter((t) => t.active)
      .forEach((t) => $("#receive-type").add(new Option(t.name, t.id)));
    $("#purchase-receive-message").textContent = "";
    receiveDialog.showModal();
  };
  function render() {
    const body = $("#purchase-table-body");
    body.replaceChildren();
    $("#purchase-empty").hidden = requests.length > 0;
    requests.forEach((r) => {
      const row = document.createElement("tr"),
        values = [`#${r.request_number}`, r.item_name, r.unit_name, r.quantity];
      values.forEach((v) => {
        const td = document.createElement("td");
        td.textContent = v;
        row.appendChild(td);
      });
      const priority = document.createElement("td"),
        p = document.createElement("span");
      p.className = "purchase-priority";
      p.textContent = r.priority;
      priority.appendChild(p);
      const details = document.createElement("td");
      details.className = "order-reason";
      details.textContent = r.justification;
      if (r.estimated_value)
        details.append(
          document.createElement("br"),
          document.createTextNode(
            `Estimado: R$ ${Number(r.estimated_value).toFixed(2)}`,
          ),
        );
      const links = document.createElement("div");
      links.className = "purchase-links";
      if (r.reference_link) {
        const a = document.createElement("a");
        a.href = r.reference_link;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Abrir referência";
        links.appendChild(a);
      }
      r.attachments.forEach((file) => {
        const a = document.createElement("a");
        a.href = `/api/purchase-requests/attachments/${file.id}`;
        a.textContent = file.name;
        links.appendChild(a);
      });
      details.appendChild(links);
      const status = document.createElement("td"),
        badge = document.createElement("span");
      badge.className = `order-status order-status--${r.status === "RECUSADO" ? "recusado" : r.status === "RECEBIDO" ? "aprovado" : r.status === "EM_COMPRA" ? "parcial" : "solicitado"}`;
      badge.textContent = labels[r.status];
      status.appendChild(badge);
      const note = r.analysis_note || r.purchase_note;
      if (note) {
        const n = document.createElement("p");
        n.className = "order-note";
        n.textContent = note;
        status.appendChild(n);
      }
      const actions = document.createElement("td");
      if (user.role === "MASTER") {
        if (r.status === "SOLICITADO")
          actions.appendChild(
            button("Analisar", () => openAction(r, "decision")),
          );
        if (r.status === "APROVADO")
          actions.appendChild(
            button("Iniciar compra", () => openAction(r, "purchase")),
          );
        if (r.status === "EM_COMPRA")
          actions.appendChild(button("Receber item", () => openReceive(r)));
      }
      row.append(priority, details, status, actions);
      body.appendChild(row);
    });
    $("#purchase-page-info").textContent =
      `Página ${page.page} de ${page.pages} · ${page.total} solicitação(ões)`;
    $("#purchase-prev").disabled = page.page <= 1;
    $("#purchase-next").disabled = page.page >= page.pages;
  }
  try {
    ({ user } = await Api.get("/auth/me"));
    if (user.role === "MASTER") ({ types } = await Api.get("/types"));
    $("#stock-orders-tab").onclick = () => {
      $("#stock-orders-content").hidden = false;
      $("#purchase-orders-content").hidden = true;
      $("#stock-orders-filter").hidden = false;
      $("#stock-orders-panel").hidden = false;
      $("#stock-orders-tab").classList.add("is-active");
      $("#purchase-orders-tab").classList.remove("is-active");
    };
    $("#purchase-orders-tab").onclick = () => {
      $("#stock-orders-content").hidden = false;
      $("#purchase-orders-content").hidden = false;
      $("#stock-orders-filter").hidden = true;
      $("#stock-orders-panel").hidden = true;
      $("#purchase-orders-tab").classList.add("is-active");
      $("#stock-orders-tab").classList.remove("is-active");
      load();
    };
    $("#purchase-action-form").onsubmit = async (e) => {
      e.preventDefault();
      const mode = $("#purchase-action-mode").value,
        id = $("#purchase-action-id").value,
        note = $("#purchase-action-note").value.trim();
      try {
        if (mode === "decision")
          await Api.post(`/purchase-requests/${id}/decision`, {
            decision: $("#purchase-decision").value,
            note,
          });
        else await Api.post(`/purchase-requests/${id}/purchase`, { note });
        actionDialog.close();
        await load();
      } catch (error) {
        $("#purchase-action-message").textContent = error.message;
      }
    };
    $("#purchase-receive-form").onsubmit = async (e) => {
      e.preventDefault();
      if (!e.currentTarget.reportValidity()) return;
      try {
        await Api.post(
          `/purchase-requests/${$("#purchase-receive-id").value}/receive`,
          {
            name: $("#receive-name").value.trim(),
            model: $("#receive-model").value.trim(),
            typeId: $("#receive-type").value,
            quantity: Number($("#receive-quantity").value),
            description: $("#receive-description").value.trim(),
          },
        );
        receiveDialog.close();
        await load();
      } catch (error) {
        $("#purchase-receive-message").textContent = error.message;
      }
    };
    document
      .querySelectorAll("[data-close-purchase-action]")
      .forEach((b) => (b.onclick = () => actionDialog.close()));
    document
      .querySelectorAll("[data-close-purchase-receive]")
      .forEach((b) => (b.onclick = () => receiveDialog.close()));
    let timer;
    const filter = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        page.page = 1;
        load();
      }, 300);
    };
    $("#purchase-search").oninput = filter;
    $("#purchase-status").onchange = filter;
    $("#purchase-prev").onclick = () => {
      page.page--;
      load();
    };
    $("#purchase-next").onclick = () => {
      page.page++;
      load();
    };
    $("#export-purchases").onclick = () =>
      (location.href = `/api/exports/purchases?${params()}`);
  } catch (error) {
    console.error(error);
  }
})();
