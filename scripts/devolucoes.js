(async () => {
  const $ = (selector) => document.querySelector(selector);
  let user;
  let inventory = [];
  let returns = [];
  let permissions = { canReceive: false };
  let cart = [];
  const reviewDialog = $("#return-review-dialog");
  const cancelDialog = $("#return-cancel-dialog");
  const cartKey = () => `almoxarifado-return-cart:${user.unitId}`;
  const notice = (message) => {
    $("#page-notice").textContent = message;
    $("#page-notice").classList.add("is-visible");
    setTimeout(() => $("#page-notice").classList.remove("is-visible"), 2000);
  };
  const saveCart = () => {
    localStorage.setItem(cartKey(), JSON.stringify(cart));
    $("#return-cart-count").textContent = cart.length;
  };
  const renderProducts = () => {
    if (user.unitCode === "MATRIZ") {
      $("#return-products").replaceChildren();
      $("#return-products-empty").hidden = true;
      return;
    }
    const query = $("#return-search").value.trim().toLocaleUpperCase("pt-BR");
    const visible = inventory.filter(
      (item) =>
        item.quantity > 0 &&
        `${item.product_name} ${item.model} ${item.type_name}`
          .toLocaleUpperCase("pt-BR")
          .includes(query),
    );
    const container = $("#return-products");
    container.replaceChildren();
    visible.forEach((item) => {
      const card = document.createElement("article");
      card.className = "return-product";
      card.innerHTML = `<div><h2></h2><p></p></div><footer><label>Quantidade disponível: ${item.quantity}<input type="number" min="1" max="${item.quantity}" step="1" value="1"></label><button type="button">Adicionar</button></footer>`;
      card.querySelector("h2").textContent = item.product_name;
      card.querySelector("p").textContent = `${item.model} · ${item.type_name}`;
      card.querySelector("button").onclick = () => {
        const input = card.querySelector("input");
        if (!input.reportValidity()) return;
        const selected = cart.find(
          (entry) => entry.productId === item.product_id,
        );
        const data = {
          productId: item.product_id,
          name: item.product_name,
          model: item.model,
          quantity: Number(input.value),
          available: item.quantity,
        };
        if (selected) Object.assign(selected, data);
        else cart.push(data);
        saveCart();
        notice(
          selected ? "Quantidade atualizada." : "Item adicionado à devolução.",
        );
      };
      container.appendChild(card);
    });
    $("#return-products-empty").hidden = visible.length > 0;
  };
  const renderReview = () => {
    const container = $("#return-review-items");
    container.replaceChildren();
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "return-review-item";
      row.innerHTML = `<div><strong></strong><small></small></div><input type="number" min="1" max="${item.available}" step="1"><button type="button">Remover</button>`;
      row.querySelector("strong").textContent = item.name;
      row.querySelector("small").textContent =
        `${item.model} · disponível: ${item.available}`;
      const input = row.querySelector("input");
      input.value = item.quantity;
      input.onchange = () => {
        if (input.reportValidity()) {
          item.quantity = Number(input.value);
          saveCart();
        }
      };
      row.querySelector("button").onclick = () => {
        cart = cart.filter((entry) => entry.productId !== item.productId);
        saveCart();
        renderReview();
      };
      container.appendChild(row);
    });
    $("#return-review-empty").hidden = cart.length > 0;
    $("#send-return").disabled = cart.length === 0;
  };
  const renderHistory = () => {
    const container = $("#return-history-list");
    container.replaceChildren();
    returns.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "return-history-card";
      const number = document.createElement("strong");
      number.textContent = `#${entry.return_number}`;
      const items = document.createElement("div");
      items.className = "return-history-items";
      entry.items.forEach((item) => {
        const line = document.createElement("span");
        line.textContent = `${item.quantity}× ${item.productName}`;
        items.appendChild(line);
      });
      const status = document.createElement("span");
      status.className = `return-status${entry.status === "RECEBIDO" ? " return-status--received" : entry.status === "CANCELADO" ? " return-status--cancelled" : ""}`;
      status.textContent = {
        SOLICITADO: "Aguardando recebimento",
        RECEBIDO: "Recebida",
        CANCELADO: "Cancelada",
      }[entry.status];
      const action = document.createElement("div");
      if (entry.status === "SOLICITADO") {
        if (permissions.canReceive) {
          const receive = document.createElement("button");
          receive.className = "primary-button";
          receive.type = "button";
          receive.textContent = "Confirmar recebimento";
          receive.onclick = async () => {
            if (
              !confirm(
                `Confirmar o recebimento da devolução #${entry.return_number}?`,
              )
            )
              return;
            try {
              await Api.post(`/returns/${entry.id}/receive`, {
                confirmed: true,
              });
              await load();
              notice("Devolução recebida e estoque atualizado.");
            } catch (error) {
              notice(error.message);
            }
          };
          action.appendChild(receive);
        }
        const button = document.createElement("button");
        button.className = "secondary-button";
        button.type = "button";
        button.textContent = "Cancelar";
        button.onclick = () => {
          $("#return-cancel-form").reset();
          $("#return-cancel-id").value = entry.id;
          $("#return-cancel-name").textContent =
            `Devolução #${entry.return_number}`;
          $("#return-cancel-message").textContent = "";
          cancelDialog.showModal();
        };
        action.appendChild(button);
      }
      card.append(number, items, status, action);
      container.appendChild(card);
    });
    $("#return-history-empty").hidden = returns.length > 0;
  };
  const load = async () => {
    const [{ inventory: stock }, data] = await Promise.all([
      Api.get("/inventory"),
      Api.get("/returns?limit=100"),
    ]);
    inventory = stock.filter((item) => item.unit_id === user.unitId);
    returns = data.returns;
    permissions = data.permissions;
    cart = cart.filter((entry) =>
      inventory.some(
        (item) =>
          item.product_id === entry.productId &&
          item.quantity >= entry.quantity,
      ),
    );
    saveCart();
    renderProducts();
    renderHistory();
  };
  try {
    ({ user } = await Api.get("/auth/me"));
    $("#session-user-name").textContent = user.name;
    $("#session-user-unit").textContent = user.unitName;
    document
      .querySelectorAll("[data-master-only]")
      .forEach((element) => (element.hidden = user.role !== "MASTER"));
    if (user.unitCode === "MATRIZ") {
      $("#returns-description").textContent =
        "A Matriz recebe e acompanha as devoluções pela tela de Pedidos.";
      $("#review-return").hidden = true;
      $("#return-search").hidden = true;
      $("#return-products").hidden = true;
      $("#return-products-empty").hidden = true;
      $(".return-history h2").textContent = "Devoluções das unidades";
    }
    try {
      cart = JSON.parse(localStorage.getItem(cartKey()) || "[]");
    } catch {
      cart = [];
    }
    await load();
    $("#return-search").oninput = renderProducts;
    $("#review-return").onclick = () => {
      renderReview();
      $("#return-review-message").textContent = "";
      reviewDialog.showModal();
    };
    $("#return-review-form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity() || !cart.length) return;
      const submit = event.submitter;
      submit.disabled = true;
      try {
        await Api.post("/returns", {
          reason: $("#return-reason").value.trim(),
          items: cart.map(({ productId, quantity }) => ({
            productId,
            quantity,
          })),
        });
        cart = [];
        saveCart();
        form.reset();
        reviewDialog.close();
        await load();
        notice("Devolução enviada para a Matriz.");
      } catch (error) {
        $("#return-review-message").textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    };
    $("#return-cancel-form").onsubmit = async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      try {
        await Api.post(`/returns/${$("#return-cancel-id").value}/cancel`, {
          reason: $("#return-cancel-reason").value.trim(),
          confirmed: true,
        });
        cancelDialog.close();
        await load();
        notice("Devolução cancelada.");
      } catch (error) {
        $("#return-cancel-message").textContent = error.message;
      }
    };
    document
      .querySelectorAll("[data-close-return-review]")
      .forEach((button) => (button.onclick = () => reviewDialog.close()));
    document
      .querySelectorAll("[data-close-return-cancel]")
      .forEach((button) => (button.onclick = () => cancelDialog.close()));
    $("#export-my-returns").onclick = () =>
      (location.href = "/api/exports/returns");
    $("#logout-button").onclick = async () => {
      await Api.post("/auth/logout", {});
      location.replace("login.html");
    };
  } catch (error) {
    notice(error.message);
  }
})();
