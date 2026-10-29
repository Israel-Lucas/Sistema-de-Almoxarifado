(async () => {
  let user,
    orders = [],
    page = { page: 1, pages: 1, total: 0 };
  const $ = (selector) => document.querySelector(selector);
  const table = $("#orders-table-body"),
    statusDialog = $("#status-dialog"),
    cancelDialog = $("#cancel-dialog");
  const labels = {
    SOLICITADO: ["Solicitado", "solicitado"],
    APROVADO: ["Aprovado", "aprovado"],
    APROVADO_PARCIALMENTE: ["Aprovado parcialmente", "parcial"],
    RECUSADO: ["Recusado", "recusado"],
    CANCELADO: ["Cancelado", "recusado"],
  };
  const show = (message) => {
    $("#page-notice").textContent = message;
    $("#page-notice").classList.add("is-visible");
    setTimeout(() => $("#page-notice").classList.remove("is-visible"), 2500);
  };
  const query = () =>
    new URLSearchParams({
      page: page.page,
      limit: 15,
      search: $("#orders-search").value.trim(),
      status: $("#status-filter").value,
    });
  const refresh = async () => {
    const data = await Api.get(`/requests/v2?${query()}`);
    orders = data.orders;
    page = data.pagination;
    render();
  };
  const button = (text, handler, danger = false) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `review-button${danger ? " review-button--danger" : ""}`;
    el.textContent = text;
    el.onclick = handler;
    return el;
  };
  const itemsSummary = (order) => {
    const wrapper = document.createElement("div");
    wrapper.className = "order-items";
    order.items.forEach((item) => {
      const line = document.createElement("div"),
        name = document.createElement("strong"),
        quantity = document.createElement("span");
      name.textContent = item.productName;
      quantity.textContent = `${item.requestedQuantity} solicitado(s)${item.approvedQuantity ? ` · ${item.approvedQuantity} aprovado(s)` : ""}`;
      line.append(name, quantity);
      if (item.note) {
        const note = document.createElement("small");
        note.textContent = item.note;
        line.appendChild(note);
      }
      wrapper.appendChild(line);
    });
    return wrapper;
  };
  const openDecision = (order) => {
    $("#status-form").reset();
    $("#status-request-id").value = order.id;
    $("#status-order-name").textContent =
      `Pedido ${order.order_number} — ${order.unit_name}`;
    $("#status-form-message").textContent = "";
    const container = $("#decision-items");
    container.replaceChildren();
    order.items.forEach((item) => {
      const section = document.createElement("section");
      section.className = "decision-item";
      section.dataset.requestId = item.id;
      section.innerHTML = `<header><div><strong></strong><small></small></div><span></span></header><div class="decision-item__fields"><label class="form-field"><span>Decisão</span><select data-decision><option value="APPROVE">Aprovar</option><option value="PARTIAL">Aprovar parcialmente</option><option value="REJECT">Recusar</option></select></label><label class="form-field" data-quantity-field><span>Quantidade aprovada</span><input data-quantity type="number" min="1" max="${item.requestedQuantity}" step="1" value="${item.requestedQuantity}" required></label><label class="form-field decision-item__note"><span>Nota</span><textarea data-note rows="2" maxlength="500"></textarea></label></div>`;
      section.querySelector("header strong").textContent = item.productName;
      section.querySelector("header small").textContent = item.model;
      section.querySelector("header span").textContent =
        `${item.requestedQuantity} solicitado(s)`;
      const decision = section.querySelector("[data-decision]");
      decision.onchange = () => {
        const reject = decision.value === "REJECT";
        section.querySelector("[data-quantity-field]").hidden = reject;
        section.querySelector("[data-quantity]").required = !reject;
      };
      container.appendChild(section);
    });
    statusDialog.showModal();
  };
  const openCancel = (order) => {
    $("#cancel-form").reset();
    $("#cancel-request-id").value = order.id;
    $("#cancel-order-name").textContent =
      `Pedido ${order.order_number} — ${order.unit_name}`;
    $("#cancel-form-message").textContent = "";
    cancelDialog.showModal();
  };
  function render() {
    table.replaceChildren();
    $("#orders-empty").hidden = orders.length > 0;
    orders.forEach((order) => {
      const row = document.createElement("tr"),
        number = document.createElement("td"),
        unit = document.createElement("td"),
        items = document.createElement("td"),
        reason = document.createElement("td"),
        date = document.createElement("td"),
        status = document.createElement("td"),
        actions = document.createElement("td");
      number.textContent = `#${order.order_number}`;
      if (order.equipment_set_name) {
        const setLabel = document.createElement("small");
        setLabel.className = "equipment-set-order-label";
        setLabel.textContent = `${order.equipment_set_quantity}× ${order.equipment_set_name}`;
        number.appendChild(setLabel);
      }
      unit.textContent = order.unit_name;
      items.appendChild(itemsSummary(order));
      reason.className = "order-reason";
      reason.textContent = order.reason;
      date.textContent = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(order.created_at));
      const [text, variant] = labels[order.status] || [
          order.status,
          "solicitado",
        ],
        badge = document.createElement("span");
      badge.className = `order-status order-status--${variant}`;
      badge.textContent =
        order.delivery_status === "PREPARANDO"
          ? `${text} — Preparando`
          : order.delivery_status === "ENTREGUE"
            ? `${text} — Entregue`
            : text;
      status.appendChild(badge);
      if (order.cancellation_reason) {
        const note = document.createElement("p");
        note.className = "order-note";
        note.textContent = order.cancellation_reason;
        status.appendChild(note);
      }
      actions.className = "order-actions";
      if (order.status === "SOLICITADO") {
        if (user.role === "MASTER")
          actions.appendChild(button("Analisar", () => openDecision(order)));
        actions.appendChild(
          button("Cancelar pedido", () => openCancel(order), true),
        );
      } else if (
        user.role === "MASTER" &&
        order.delivery_status === "PREPARANDO"
      )
        actions.appendChild(
          button("Marcar entregue", async () => {
            if (
              !confirm(
                `Confirmar a entrega de todos os itens aprovados do pedido ${order.order_number}?`,
              )
            )
              return;
            try {
              await Api.post(`/requests/groups/${order.id}/deliver`, {
                confirmed: true,
              });
              await refresh();
              show("Pedido marcado como entregue.");
            } catch (error) {
              show(error.message);
            }
          }),
        );
      row.append(number, unit, items, reason, date, status, actions);
      table.appendChild(row);
    });
    $("#orders-page-info").textContent =
      `Página ${page.page} de ${page.pages} · ${page.total} pedido(s)`;
    $("#orders-prev").disabled = page.page <= 1;
    $("#orders-next").disabled = page.page >= page.pages;
  }
  try {
    ({ user } = await Api.get("/auth/me"));
    $("#session-user-name").textContent = user.name;
    $("#session-user-unit").textContent = user.unitName;
    document
      .querySelectorAll("[data-master-only]")
      .forEach((el) => (el.hidden = user.role !== "MASTER"));
    $("#orders-description").textContent =
      user.role === "MASTER"
        ? "Acompanhe os pedidos completos de todas as unidades."
        : `Acompanhe os pedidos da unidade ${user.unitName}.`;
    await refresh();
    $("#status-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      const items = [...document.querySelectorAll(".decision-item")].map(
        (section) => {
          const decision = section.querySelector("[data-decision]").value,
            result = {
              requestId: section.dataset.requestId,
              decision,
              note: section.querySelector("[data-note]").value.trim(),
            };
          if (decision !== "REJECT")
            result.approvedQuantity = Number(
              section.querySelector("[data-quantity]").value,
            );
          return result;
        },
      );
      try {
        await Api.post(
          `/requests/groups/${$("#status-request-id").value}/decision`,
          { items, confirmed: true },
        );
        statusDialog.close();
        await refresh();
        show("Pedido analisado com sucesso.");
      } catch (error) {
        $("#status-form-message").textContent = error.message;
      }
    };
    $("#cancel-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      try {
        await Api.post(
          `/requests/groups/${$("#cancel-request-id").value}/cancel`,
          { reason: $("#cancel-reason").value.trim(), confirmed: true },
        );
        cancelDialog.close();
        await refresh();
        show("Pedido cancelado.");
      } catch (error) {
        $("#cancel-form-message").textContent = error.message;
      }
    };
    $("#close-status-dialog").onclick = $("#cancel-status-dialog").onclick =
      () => statusDialog.close();
    document
      .querySelectorAll("[data-close-cancel]")
      .forEach((el) => (el.onclick = () => cancelDialog.close()));
    let timer;
    const filter = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        page.page = 1;
        refresh().catch((error) => show(error.message));
      }, 300);
    };
    $("#orders-search").oninput = filter;
    $("#status-filter").onchange = filter;
    $("#orders-prev").onclick = () => {
      page.page--;
      refresh();
    };
    $("#orders-next").onclick = () => {
      page.page++;
      refresh();
    };
    $("#export-orders").onclick = () =>
      (location.href = `/api/exports/requests?${query()}`);
    $("#logout-button").onclick = async () => {
      await Api.post("/auth/logout", {});
      location.replace("login.html");
    };
  } catch (error) {
    show(error.message);
  }
})();
