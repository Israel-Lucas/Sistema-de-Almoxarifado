(async () => {
  const $ = (selector) => document.querySelector(selector);
  let user;
  let returns = [];
  let permissions = { canReceive: false, canCancel: false };
  let page = { page: 1, pages: 1, total: 0 };
  const params = () =>
    new URLSearchParams({
      page: page.page,
      limit: 15,
      search: $("#return-orders-search").value.trim(),
      status: $("#return-orders-status").value,
    });
  const load = async () => {
    const data = await Api.get(`/returns?${params()}`);
    returns = data.returns;
    permissions = data.permissions;
    page = data.pagination;
    render();
  };
  const render = () => {
    const body = $("#return-orders-body");
    body.replaceChildren();
    returns.forEach((entry) => {
      const row = document.createElement("tr");
      const number = document.createElement("td");
      number.textContent = `#${entry.return_number}`;
      const unit = document.createElement("td");
      unit.textContent = entry.unit_name;
      const items = document.createElement("td");
      items.className = "order-items";
      entry.items.forEach((item) => {
        const line = document.createElement("div");
        const name = document.createElement("strong");
        const quantity = document.createElement("span");
        name.textContent = item.productName;
        quantity.textContent = `${item.quantity} devolvido(s)`;
        line.append(name, quantity);
        items.appendChild(line);
      });
      const reason = document.createElement("td");
      reason.className = "order-reason";
      reason.textContent = entry.reason;
      const date = document.createElement("td");
      date.textContent = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(entry.created_at));
      const status = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `order-status order-status--${entry.status === "RECEBIDO" ? "aprovado" : entry.status === "CANCELADO" ? "recusado" : "solicitado"}`;
      badge.textContent = {
        SOLICITADO: "Aguardando recebimento",
        RECEBIDO: "Recebida",
        CANCELADO: "Cancelada",
      }[entry.status];
      status.appendChild(badge);
      if (entry.cancellation_reason) {
        const note = document.createElement("p");
        note.className = "order-note";
        note.textContent = entry.cancellation_reason;
        status.appendChild(note);
      }
      const action = document.createElement("td");
      action.className = "order-actions";
      if (permissions.canReceive && entry.status === "SOLICITADO") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "review-button";
        button.textContent = "Confirmar recebimento";
        button.onclick = async () => {
          if (
            !confirm(
              `Confirmar o recebimento da devolução #${entry.return_number}?`,
            )
          )
            return;
          try {
            await Api.post(`/returns/${entry.id}/receive`, { confirmed: true });
            await load();
            const notice = $("#page-notice");
            notice.textContent = "Devolução recebida e estoque atualizado.";
            notice.classList.add("is-visible");
            setTimeout(() => notice.classList.remove("is-visible"), 2000);
          } catch (error) {
            const notice = $("#page-notice");
            notice.textContent = error.message;
            notice.classList.add("is-visible");
            setTimeout(() => notice.classList.remove("is-visible"), 2000);
          }
        };
        action.appendChild(button);
      }
      if (permissions.canCancel && entry.status === "SOLICITADO") {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "review-button review-button--danger";
        cancel.textContent = "Cancelar";
        cancel.onclick = () => {
          $("#return-order-cancel-form").reset();
          $("#return-order-cancel-id").value = entry.id;
          $("#return-order-cancel-name").textContent =
            `Devolução #${entry.return_number}`;
          $("#return-order-cancel-message").textContent = "";
          $("#return-order-cancel-dialog").showModal();
        };
        action.appendChild(cancel);
      }
      row.append(number, unit, items, reason, date, status, action);
      body.appendChild(row);
    });
    $("#return-orders-empty").hidden = returns.length > 0;
    $("#return-orders-page-info").textContent =
      `Página ${page.page} de ${page.pages} · ${page.total} devolução(ões)`;
    $("#return-orders-prev").disabled = page.page <= 1;
    $("#return-orders-next").disabled = page.page >= page.pages;
  };
  try {
    ({ user } = await Api.get("/auth/me"));
    $("#return-orders-tab").onclick = () => {
      $("#stock-orders-filter").hidden = true;
      $("#stock-orders-panel").hidden = true;
      $("#purchase-orders-content").hidden = true;
      $("#return-orders-content").hidden = false;
      $("#stock-orders-tab").classList.remove("is-active");
      $("#purchase-orders-tab").classList.remove("is-active");
      $("#return-orders-tab").classList.add("is-active");
      load();
    };
    const stockHandler = $("#stock-orders-tab").onclick;
    $("#stock-orders-tab").onclick = () => {
      $("#return-orders-content").hidden = true;
      $("#return-orders-tab").classList.remove("is-active");
      stockHandler();
    };
    const purchaseHandler = $("#purchase-orders-tab").onclick;
    $("#purchase-orders-tab").onclick = () => {
      $("#return-orders-content").hidden = true;
      $("#return-orders-tab").classList.remove("is-active");
      purchaseHandler();
    };
    let timer;
    const filter = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        page.page = 1;
        load();
      }, 300);
    };
    $("#return-orders-search").oninput = filter;
    $("#return-orders-status").onchange = filter;
    $("#return-orders-prev").onclick = () => {
      page.page--;
      load();
    };
    $("#return-orders-next").onclick = () => {
      page.page++;
      load();
    };
    $("#export-returns").onclick = () =>
      (location.href = `/api/exports/returns?${params()}`);
    $("#return-order-cancel-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      try {
        await Api.post(
          `/returns/${$("#return-order-cancel-id").value}/cancel`,
          {
            reason: $("#return-order-cancel-reason").value.trim(),
            confirmed: true,
          },
        );
        $("#return-order-cancel-dialog").close();
        await load();
      } catch (error) {
        $("#return-order-cancel-message").textContent = error.message;
      }
    };
    document
      .querySelectorAll("[data-close-return-order-cancel]")
      .forEach(
        (button) =>
          (button.onclick = () => $("#return-order-cancel-dialog").close()),
      );
    if (new URLSearchParams(location.search).get("tab") === "returns")
      $("#return-orders-tab").click();
  } catch (error) {
    console.error(error);
  }
})();
