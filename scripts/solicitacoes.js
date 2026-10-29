(async () => {
  let user,
    products = [],
    types = [],
    units = [],
    equipmentSets = [],
    catalogProducts = [],
    selectedEquipmentSet = null,
    editingKitId = null,
    productPage = { page: 1, pages: 1, total: 0 },
    cart = [];
  const productList = document.querySelector("#product-list"),
    emptyState = document.querySelector("#products-empty"),
    searchInput = document.querySelector("#product-search"),
    productDialog = document.querySelector("#product-dialog"),
    quantityDialog = document.querySelector("#quantity-dialog"),
    requestDialog = document.querySelector("#request-dialog"),
    cartDialog = document.querySelector("#cart-dialog"),
    purchaseDialog = document.querySelector("#purchase-dialog"),
    typeDialog = document.querySelector("#type-dialog"),
    itemKindDialog = document.querySelector("#item-kind-dialog"),
    kitBuilderDialog = document.querySelector("#kit-builder-dialog"),
    setRequestDialog = document.querySelector("#set-request-dialog"),
    notice = document.querySelector("#page-notice");
  const showNotice = (message) => {
    notice.textContent = message;
    notice.classList.add("is-visible");
    setTimeout(() => notice.classList.remove("is-visible"), 2600);
  };
  const cartKey = () => `almoxarifado-cart:${user?.unitId || "unknown"}`;
  const saveCart = () => {
    localStorage.setItem(cartKey(), JSON.stringify(cart));
    document.querySelector("#cart-count").textContent = cart.length;
  };
  const renderCart = () => {
    const container = document.querySelector("#cart-items");
    container.replaceChildren();
    document.querySelector("#cart-empty").hidden = cart.length > 0;
    document.querySelector("#send-cart-button").disabled = cart.length === 0;
    cart.forEach((item) => {
      const row = document.createElement("div");
      row.className = "cart-review__item";
      const description = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = item.name;
      const model = document.createElement("small");
      model.textContent = item.model;
      description.append(name, model);
      const quantity = document.createElement("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = String(item.available);
      quantity.step = "1";
      quantity.value = item.quantity;
      quantity.setAttribute("aria-label", `Quantidade de ${item.name}`);
      quantity.onchange = () => {
        if (!quantity.reportValidity()) return;
        item.quantity = Number(quantity.value);
        saveCart();
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cart-review__remove";
      remove.textContent = "Remover";
      remove.onclick = () => {
        cart = cart.filter((entry) => entry.productId !== item.productId);
        saveCart();
        renderCart();
      };
      row.append(description, quantity, remove);
      container.appendChild(row);
    });
  };
  let successTimer;
  const showSuccess = (message) => {
    const overlay = document.querySelector("#success-overlay");
    clearTimeout(successTimer);
    document.querySelector("#success-overlay-message").textContent = message;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    successTimer = setTimeout(() => {
      overlay.classList.remove("is-visible");
      setTimeout(() => (overlay.hidden = true), 180);
    }, 2000);
  };
  const refresh = async () => {
    const productQuery = new URLSearchParams({
      page: productPage.page,
      limit: 20,
      search: searchInput.value.trim(),
    });
    const [productData, setData, allProductData] = await Promise.all([
      Api.get(`/products?${productQuery}`),
      Api.get("/equipment-sets"),
      Api.get("/products?limit=100"),
    ]);
    products = productData.products;
    equipmentSets = setData.sets;
    catalogProducts = allProductData.products;
    productPage = productData.pagination;
    [{ types }, { units }] = await Promise.all([
      Api.get("/types"),
      Api.get("/units"),
    ]);
    renderProducts();
    renderEquipmentSets();
    fillTypes();
    document.querySelector("#products-page-info").textContent =
      `Página ${productPage.page} de ${productPage.pages} · ${productPage.total} item(ns) avulso(s) + ${equipmentSets.length} kit(s)`;
    document.querySelector("#products-prev").disabled = productPage.page <= 1;
    document.querySelector("#products-next").disabled =
      productPage.page >= productPage.pages;
  };
  const openSetRequest = (set) => {
    selectedEquipmentSet = set;
    document.querySelector("#set-request-name").textContent = set.name;
    document.querySelector("#set-request-quantity").value = 1;
    document.querySelector("#set-request-reason").value = "";
    const container = document.querySelector("#set-request-components");
    container.replaceChildren();
    set.components.forEach((component) => {
      const row = document.createElement("div");
      row.className = "set-request-component";
      const name = document.createElement("span");
      name.textContent = `${component.quantity}× ${component.productName}`;
      if (component.required) {
        const label = document.createElement("strong");
        label.textContent = "Obrigatório";
        row.append(name, label);
      } else {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.dataset.componentId = component.id;
        label.append(checkbox, "Incluir opcional");
        row.append(name, label);
      }
      container.appendChild(row);
    });
    setRequestDialog.showModal();
  };
  const renderEquipmentSets = () => {
    if (productPage.page !== 1) return;
    const query = searchInput.value.trim().toLocaleUpperCase("pt-BR");
    const visibleSets = equipmentSets.filter((set) =>
      `${set.name} ${set.type_name || ""} ${set.description || ""} ${set.components.map((item) => item.productName).join(" ")}`
        .toLocaleUpperCase("pt-BR")
        .includes(query),
    );
    visibleSets.forEach((set) => {
      const card = document.createElement("article");
      card.className = "product-card product-card--kit";
      card.innerHTML = `<div class="product-card__header"><div><h2></h2><p class="product-card__model"></p></div><span class="product-card__type"></span></div><p class="product-card__description"></p><div class="kit-card__components"></div><div class="product-card__footer"><div class="product-card__quantity"><small>Disponível na Matriz</small><strong></strong></div><div class="product-card__action"></div></div>`;
      const componentAvailability = set.components.map((component) => ({
        ...component,
        availableKits: Math.floor(
          component.matrixQuantity / component.quantity,
        ),
      }));
      const limitingComponent = componentAvailability.reduce(
        (lowest, component) =>
          !lowest || component.availableKits < lowest.availableKits
            ? component
            : lowest,
        null,
      );
      const availability = limitingComponent?.availableKits ?? 0;
      card.querySelector("h2").textContent = set.name;
      card.querySelector(".product-card__model").textContent = "Kit de itens";
      card.querySelector(".product-card__type").textContent =
        set.type_name || "Kit";
      card.querySelector(".product-card__description").textContent =
        set.description || "Sem descrição.";
      card.querySelector(".product-card__quantity strong").textContent =
        Number.isFinite(availability) ? availability : 0;
      const components = card.querySelector(".kit-card__components");
      set.components.forEach((component) => {
        const item = document.createElement("span");
        item.textContent = `${component.quantity}× ${component.productName}`;
        if (!component.required) {
          const optional = document.createElement("small");
          optional.textContent = " · opcional";
          item.appendChild(optional);
        }
        components.appendChild(item);
      });
      if (limitingComponent) {
        const limit = document.createElement("p");
        limit.className = "kit-card__limit";
        limit.textContent = `Limitado por: ${limitingComponent.productName} (saldo ${limitingComponent.matrixQuantity})`;
        components.after(limit);
      }
      if (user.role !== "MASTER" && user.unitCode !== "MATRIZ") {
        const button = document.createElement("button");
        button.className = "request-button";
        button.type = "button";
        button.textContent = "Solicitar";
        button.addEventListener("click", () => openSetRequest(set));
        card.querySelector(".product-card__action").appendChild(button);
      } else if (user.role === "MASTER") {
        const action = card.querySelector(".product-card__action");
        action.className = "product-card__action quantity-actions";
        const edit = document.createElement("button");
        edit.className = "product-card__stock-action";
        edit.type = "button";
        edit.textContent = "Editar";
        edit.addEventListener("click", () => openKitBuilder(set));
        action.appendChild(edit);
      }
      productList.appendChild(card);
    });
    emptyState.hidden = productList.children.length > 0;
  };
  const kitTypeOptions = (selected = "") => {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(new Option("Selecione", ""));
    types
      .filter((type) => type.active)
      .forEach((type) =>
        fragment.appendChild(
          new Option(type.name, type.id, false, type.id === selected),
        ),
      );
    return fragment;
  };
  const addKitComponentRow = (component = null) => {
    const row = document.createElement("article");
    row.className = "kit-component-row";
    row.innerHTML = `<div class="kit-component-row__top"><label class="form-field"><span>Origem do item</span><select class="kit-component-mode"><option value="EXISTING">Selecionar item existente</option><option value="NEW">Cadastrar item novo</option></select></label><label class="form-field"><span>Quantidade no kit</span><input class="kit-component-quantity" type="number" min="1" max="99" value="1" required /></label><button class="remove-kit-component" type="button" aria-label="Remover item">×</button></div><div class="kit-existing-fields"><label class="form-field"><span>Item existente</span><select class="kit-existing-product" required></select></label></div><div class="kit-new-fields" hidden><label class="form-field"><span>Nome</span><input class="kit-new-name" maxlength="100" /></label><label class="form-field"><span>Marca ou modelo</span><input class="kit-new-model" maxlength="100" /></label><label class="form-field"><span>Tipo do item</span><select class="kit-new-type"></select></label><label class="form-field"><span>Estoque inicial</span><input class="kit-new-stock" type="number" min="0" max="999" value="0" /></label><label class="form-field kit-new-description"><span>Descrição</span><textarea class="kit-new-description-input" maxlength="500" rows="2"></textarea></label></div>`;
    const productSelect = row.querySelector(".kit-existing-product");
    productSelect.appendChild(new Option("Selecione um item", ""));
    catalogProducts.forEach((product) =>
      productSelect.appendChild(
        new Option(
          `${product.name} — ${product.model} (saldo ${product.matrix_quantity})`,
          product.id,
        ),
      ),
    );
    if (component?.productId) productSelect.value = component.productId;
    if (component?.quantity)
      row.querySelector(".kit-component-quantity").value = component.quantity;
    row.querySelector(".kit-new-type").appendChild(kitTypeOptions());
    const mode = row.querySelector(".kit-component-mode");
    mode.addEventListener("change", () => {
      const isNew = mode.value === "NEW";
      row.querySelector(".kit-existing-fields").hidden = isNew;
      row.querySelector(".kit-new-fields").hidden = !isNew;
      productSelect.required = !isNew;
      row.querySelector(".kit-new-name").required = isNew;
      row.querySelector(".kit-new-model").required = isNew;
      row.querySelector(".kit-new-type").required = isNew;
    });
    row.querySelector(".remove-kit-component").addEventListener("click", () => {
      if (document.querySelectorAll(".kit-component-row").length <= 2) {
        document.querySelector("#kit-builder-message").textContent =
          "O kit precisa ter pelo menos dois itens.";
        return;
      }
      row.remove();
    });
    document.querySelector("#kit-component-rows").appendChild(row);
  };
  const openKitBuilder = (set = null) => {
    editingKitId = set?.id || null;
    document.querySelector("#kit-builder-form").reset();
    const kitType = document.querySelector("#kit-type");
    kitType.replaceChildren();
    kitType.appendChild(kitTypeOptions());
    kitType.value = set?.type_id || "";
    document.querySelector("#kit-name").value = set?.name || "";
    document.querySelector("#kit-description").value = set?.description || "";
    document.querySelector("#kit-builder-dialog h2").textContent = set
      ? "Editar kit de itens"
      : "Cadastrar kit de itens";
    document.querySelector("#delete-kit-in-edit").hidden = !set;
    document.querySelector("#kit-component-rows").replaceChildren();
    if (set?.components?.length)
      set.components.forEach((component) => addKitComponentRow(component));
    else {
      addKitComponentRow();
      addKitComponentRow();
    }
    document.querySelector("#kit-builder-message").textContent = "";
    kitBuilderDialog.showModal();
  };
  const fillTypes = () => {
    const select = document.querySelector("#product-type"),
      value = select.value;
    select.replaceChildren(new Option("Selecione um tipo", "", true, false));
    select.options[0].disabled = true;
    types
      .filter((type) => type.active)
      .forEach((type) => select.add(new Option(type.name, type.id)));
    if ([...select.options].some((option) => option.value === value))
      select.value = value;
  };
  const fillEditTypes = (selected) => {
    const select = document.querySelector("#edit-product-type");
    select.replaceChildren();
    types
      .filter((type) => type.active)
      .forEach((type) => select.add(new Option(type.name, type.id)));
    select.value = selected;
  };
  const fillUnits = (product) => {
    [
      ["#stock-remove-unit", "Não remover"],
      ["#stock-add-unit", "Não acrescentar"],
    ].forEach(([selector, placeholder]) => {
      const select = document.querySelector(selector);
      select.replaceChildren(new Option(placeholder, ""));
      units
        .filter((unit) => unit.active)
        .forEach((unit) => {
          const stock = product.stock_by_unit.find(
            (item) => item.unit_id === unit.id,
          );
          select.add(
            new Option(
              `${unit.name} — saldo: ${stock?.quantity ?? 0}`,
              unit.id,
            ),
          );
        });
    });
  };
  const renderTypes = () => {
    const container = document.querySelector("#types-list");
    container.replaceChildren();
    document.querySelector("#types-empty").hidden = types.length > 0;
    types.forEach((type) => {
      const row = document.createElement("div");
      row.className = "management-list__item";
      const name = document.createElement("span");
      name.textContent = `${type.name}${type.active ? "" : " (desativado)"}`;
      const actions = document.createElement("div");
      actions.className = "management-list__actions";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "management-list__toggle";
      toggle.textContent = type.active ? "Desativar" : "Ativar";
      toggle.addEventListener("click", async () => {
        if (
          !confirm(
            `${type.active ? "Desativar" : "Ativar"} o tipo “${type.name}”?`,
          )
        )
          return;
        try {
          await Api.patch(`/types/${type.id}/active`, { active: !type.active });
          await refresh();
          renderTypes();
        } catch (error) {
          document.querySelector("#type-form-message").textContent =
            error.message;
        }
      });
      actions.appendChild(toggle);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "management-list__toggle";
      edit.textContent = "Editar";
      edit.addEventListener("click", async () => {
        const name = prompt("Novo nome do tipo:", type.name)?.trim();
        if (!name || name === type.name) return;
        try {
          await Api.put(`/types/${type.id}`, { name });
          await refresh();
          renderTypes();
        } catch (error) {
          document.querySelector("#type-form-message").textContent =
            error.message;
        }
      });
      actions.prepend(edit);
      if (user.unitCode === "MATRIZ") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "management-list__delete";
        remove.textContent = "Excluir";
        remove.addEventListener("click", async () => {
          if (
            !confirm(
              `EXCLUIR definitivamente o tipo “${type.name}”? Esta ação só será aceita se ele não possuir produtos.`,
            )
          )
            return;
          try {
            await Api.delete(`/types/${type.id}`, {});
            await refresh();
            renderTypes();
          } catch (error) {
            document.querySelector("#type-form-message").textContent =
              error.message;
          }
        });
        actions.appendChild(remove);
      }
      row.append(name, actions);
      container.appendChild(row);
    });
  };
  const openQuantity = (product) => {
    document.querySelector("#quantity-form").reset();
    document.querySelector("#quantity-product-id").value = product.id;
    document.querySelector("#quantity-product-name").textContent = product.name;
    document.querySelector("#edit-product-name").value = product.name;
    document.querySelector("#edit-product-model").value = product.model;
    document.querySelector("#edit-product-description").value =
      product.description || "";
    fillEditTypes(product.type_id);
    quantityDialog.dataset.productId = product.id;
    document.querySelector("#quantity-form-message").textContent = "";
    document.querySelector("#stock-remove-quantity").disabled = true;
    document.querySelector("#stock-add-quantity").disabled = true;
    document.querySelector("#stock-add-quantity").max = 999;
    fillUnits(product);
    quantityDialog.showModal();
  };
  const openRequest = (product) => {
    document.querySelector("#request-form").reset();
    document.querySelector("#request-product-id").value = product.id;
    document.querySelector("#request-product-name").textContent =
      `${product.name} — ${product.model}`;
    document.querySelector("#request-quantity").max = product.matrix_quantity;
    requestDialog.showModal();
  };
  const renderProducts = () => {
    const query = searchInput.value.trim().toLocaleUpperCase("pt-BR");
    const filtered = products.filter((product) =>
      `${product.name} ${product.model} ${product.type_name}`
        .toLocaleUpperCase("pt-BR")
        .includes(query),
    );
    productList.replaceChildren();
    emptyState.hidden = filtered.length > 0;
    filtered.forEach((product) => {
      const card = document.createElement("article");
      card.className = "product-card";
      card.innerHTML = `<div class="product-card__header"><div><h2></h2><p class="product-card__model"></p></div><span class="product-card__type"></span></div><p class="product-card__description"></p><div class="product-card__locations" hidden></div><div class="product-card__footer"><div class="product-card__quantity"><small>Disponível na Matriz</small><strong>${product.matrix_quantity}</strong></div><div class="product-card__action"></div></div>`;
      card.querySelector("h2").textContent = product.name;
      card.querySelector(".product-card__model").textContent =
        `Modelo: ${product.model}`;
      card.querySelector(".product-card__type").textContent = product.type_name;
      card.querySelector(".product-card__description").textContent =
        product.description || "Sem descrição.";
      const action = card.querySelector(".product-card__action");
      if (user.role === "MASTER") {
        if (product.matrix_quantity <= 5) {
          const warning = document.createElement("span");
          warning.className = "product-card__stock-warning";
          warning.textContent =
            product.matrix_quantity === 0
              ? "Matriz sem estoque"
              : "Estoque baixo na Matriz";
          card
            .querySelector(".product-card__header > div")
            .appendChild(warning);
        }
        const locations = card.querySelector(".product-card__locations");
        const distributed = product.stock_by_unit.filter(
          (item) => item.unit_code !== "MATRIZ" && item.quantity > 0,
        );
        locations.hidden = false;
        locations.innerHTML = "<small>Distribuído nas unidades</small>";
        if (!distributed.length) {
          const empty = document.createElement("span");
          empty.textContent = "Nenhum item distribuído";
          locations.appendChild(empty);
        } else {
          distributed.forEach((item) => {
            const location = document.createElement("span");
            location.textContent = `${item.unit_name}: ${item.quantity}`;
            locations.appendChild(location);
          });
        }
        action.className = "product-card__action quantity-actions";
        const changeStock = document.createElement("button");
        changeStock.type = "button";
        changeStock.className = "product-card__stock-action";
        changeStock.textContent = "Editar";
        changeStock.addEventListener("click", () => openQuantity(product));
        action.appendChild(changeStock);
      } else {
        if (user.unitCode === "MATRIZ") {
          const label = document.createElement("span");
          label.className = "matrix-stock-label";
          label.textContent = "Estoque do almoxarifado";
          action.appendChild(label);
          productList.appendChild(card);
          return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "request-button";
        button.textContent = "Solicitar";
        button.addEventListener("click", () => openRequest(product));
        action.appendChild(button);
      }
      productList.appendChild(card);
    });
  };
  try {
    ({ user } = await Api.get("/auth/me"));
    document.querySelector("#session-user-name").textContent = user.name;
    document.querySelector("#session-user-unit").textContent = user.unitName;
    document
      .querySelectorAll("[data-master-only]")
      .forEach((element) => (element.hidden = user.role !== "MASTER"));
    document.querySelector("#page-description").textContent =
      user.role === "MASTER"
        ? "Cadastre itens e gerencie suas quantidades por unidade."
        : "Consulte o catálogo e envie solicitações para sua unidade.";
    if (user.role === "MASTER")
      document.querySelector("#master-catalog-actions").hidden = false;
    await refresh();
    if (user.role !== "MASTER") {
      try {
        cart = JSON.parse(localStorage.getItem(cartKey()) || "[]");
      } catch {
        cart = [];
      }
      const canRequest = user.unitCode !== "MATRIZ";
      document.querySelector("#request-actions").hidden = !canRequest;
      document.querySelector("#open-cart-button").hidden = !canRequest;
      document.querySelector("#new-purchase-button").hidden = !canRequest;
      if (!canRequest)
        document.querySelector("#page-description").textContent =
          "A Matriz representa o estoque do almoxarifado. Solicitações devem ser destinadas a outra unidade.";
      saveCart();
    }
    document
      .querySelector("#add-product-button")
      .addEventListener("click", () => {
        itemKindDialog.showModal();
      });
    document
      .querySelector("#choose-single-item")
      .addEventListener("click", () => {
        itemKindDialog.close();
        document.querySelector("#product-form").reset();
        fillTypes();
        productDialog.showModal();
      });
    document.querySelector("#choose-kit-item").addEventListener("click", () => {
      itemKindDialog.close();
      openKitBuilder();
    });
    document
      .querySelector("#add-kit-component")
      .addEventListener("click", addKitComponentRow);
    document
      .querySelector("#delete-kit-in-edit")
      .addEventListener("click", async () => {
        if (!editingKitId) return;
        const set = equipmentSets.find((item) => item.id === editingKitId);
        if (
          !confirm(
            `Excluir o kit “${set?.name || "selecionado"}”? Os itens e pedidos antigos serão preservados.`,
          )
        )
          return;
        try {
          await Api.delete(`/equipment-sets/${editingKitId}`, {
            confirmed: true,
          });
          kitBuilderDialog.close();
          await refresh();
          showNotice("Kit excluído do catálogo.");
        } catch (error) {
          document.querySelector("#kit-builder-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#kit-builder-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const components = [
          ...document.querySelectorAll(".kit-component-row"),
        ].map((row) => {
          const isNew =
            row.querySelector(".kit-component-mode").value === "NEW";
          return {
            productId: isNew
              ? null
              : row.querySelector(".kit-existing-product").value,
            quantity: Number(
              row.querySelector(".kit-component-quantity").value,
            ),
            name: isNew ? row.querySelector(".kit-new-name").value.trim() : "",
            model: isNew
              ? row.querySelector(".kit-new-model").value.trim()
              : "",
            typeId: isNew ? row.querySelector(".kit-new-type").value : null,
            description: isNew
              ? row.querySelector(".kit-new-description-input").value.trim()
              : "",
            initialQuantity: isNew
              ? Number(row.querySelector(".kit-new-stock").value)
              : 0,
          };
        });
        try {
          const payload = {
            name: document.querySelector("#kit-name").value.trim(),
            typeId: document.querySelector("#kit-type").value,
            description: document
              .querySelector("#kit-description")
              .value.trim(),
            components,
          };
          if (editingKitId)
            await Api.put(`/equipment-sets/${editingKitId}/builder`, payload);
          else await Api.post("/equipment-sets/builder", payload);
          kitBuilderDialog.close();
          await refresh();
          showSuccess(
            editingKitId
              ? "Kit atualizado com sucesso."
              : "Kit criado e adicionado ao catálogo.",
          );
        } catch (error) {
          document.querySelector("#kit-builder-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#create-type-button")
      .addEventListener("click", () => {
        document.querySelector("#type-form").reset();
        document.querySelector("#type-form-message").textContent = "";
        renderTypes();
        typeDialog.showModal();
      });
    document
      .querySelector("#type-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        try {
          await Api.post("/types", {
            name: document.querySelector("#type-name").value.trim(),
          });
          form.reset();
          await refresh();
          renderTypes();
          document.querySelector("#type-name").focus();
          document.querySelector("#type-form-message").textContent = "";
        } catch (error) {
          document.querySelector("#type-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#product-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const data = new FormData(event.currentTarget);
        try {
          await Api.post("/products", {
            name: data.get("name").trim(),
            initialQuantity: Number(data.get("quantity")),
            description: data.get("description").trim(),
            typeId: data.get("type"),
            model: data.get("model").trim(),
          });
          productDialog.close();
          await refresh();
          showNotice("Item criado com sucesso.");
        } catch (error) {
          document.querySelector("#product-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#quantity-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const removeUnit = document.querySelector("#stock-remove-unit"),
          addUnit = document.querySelector("#stock-add-unit"),
          removal = removeUnit.value
            ? {
                unitId: removeUnit.value,
                quantity: Number(
                  document.querySelector("#stock-remove-quantity").value,
                ),
              }
            : null,
          addition = addUnit.value
            ? {
                unitId: addUnit.value,
                quantity: Number(
                  document.querySelector("#stock-add-quantity").value,
                ),
              }
            : null;
        if (!removal && !addition) {
          document.querySelector("#quantity-form-message").textContent =
            "Selecione uma unidade para remover ou acrescentar estoque.";
          return;
        }
        if (removal && addition && addition.quantity > removal.quantity) {
          document.querySelector("#quantity-form-message").textContent =
            `Você está removendo ${removal.quantity} e tentando acrescentar ${addition.quantity}. O acréscimo deve ser igual ou menor que a remoção.`;
          return;
        }
        const description = [
          removal &&
            `REMOVER ${removal.quantity} de ${removeUnit.selectedOptions[0].textContent}`,
          addition &&
            `ACRESCENTAR ${addition.quantity} em ${addUnit.selectedOptions[0].textContent}`,
        ]
          .filter(Boolean)
          .join(" e ");
        if (
          !confirm(
            `CONFIRMAR ALTERAÇÃO: ${description}? Confira as unidades antes de continuar.`,
          )
        )
          return;
        try {
          await Api.post("/inventory/change", {
            productId: document.querySelector("#quantity-product-id").value,
            removal,
            addition,
            confirmed: true,
          });
          quantityDialog.close();
          await refresh();
          showSuccess("O estoque do item foi atualizado com sucesso.");
        } catch (error) {
          document.querySelector("#quantity-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#save-product-data")
      .addEventListener("click", async () => {
        const message = document.querySelector("#quantity-form-message");
        if (!document.querySelector("#quantity-form").reportValidity()) return;
        try {
          await Api.put(`/products/${quantityDialog.dataset.productId}`, {
            name: document.querySelector("#edit-product-name").value.trim(),
            model: document.querySelector("#edit-product-model").value.trim(),
            description: document
              .querySelector("#edit-product-description")
              .value.trim(),
            typeId: document.querySelector("#edit-product-type").value,
          });
          quantityDialog.close();
          await refresh();
          showSuccess("Os dados do item foram atualizados com sucesso.");
        } catch (error) {
          message.textContent = error.message;
        }
      });
    document
      .querySelector("#delete-product-in-edit")
      .addEventListener("click", async () => {
        const id = quantityDialog.dataset.productId;
        if (!confirm("EXCLUIR este item? O saldo total precisa estar zerado."))
          return;
        try {
          await Api.delete(`/products/${id}`, { confirmed: true });
          quantityDialog.close();
          await refresh();
          showNotice("Item excluído.");
        } catch (error) {
          document.querySelector("#quantity-form-message").textContent =
            error.message;
        }
      });
    const updateAdditionLimit = () => {
      const removeUnit = document.querySelector("#stock-remove-unit"),
        removeQuantity = document.querySelector("#stock-remove-quantity"),
        additionInput = document.querySelector("#stock-add-quantity");
      additionInput.max =
        removeUnit.value && Number(removeQuantity.value) > 0
          ? removeQuantity.value
          : 999;
    };
    const bindStockSide = (selectId, quantityId) => {
      document.querySelector(selectId).addEventListener("change", (event) => {
        const input = document.querySelector(quantityId);
        input.disabled = !event.target.value;
        input.required = Boolean(event.target.value);
        if (input.disabled) input.value = "";
        updateAdditionLimit();
      });
    };
    bindStockSide("#stock-remove-unit", "#stock-remove-quantity");
    bindStockSide("#stock-add-unit", "#stock-add-quantity");
    document
      .querySelector("#stock-remove-quantity")
      .addEventListener("input", updateAdditionLimit);
    document
      .querySelector("#request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const product = products.find(
          (item) =>
            item.id === document.querySelector("#request-product-id").value,
        );
        const quantity = Number(
          document.querySelector("#request-quantity").value,
        );
        const existing = cart.find((item) => item.productId === product.id);
        if (existing) existing.quantity = quantity;
        else
          cart.push({
            productId: product.id,
            name: product.name,
            model: product.model,
            quantity,
            available: product.matrix_quantity,
          });
        saveCart();
        requestDialog.close();
        showNotice(
          existing
            ? "Quantidade atualizada no pedido."
            : "Item adicionado ao pedido.",
        );
      });
    document
      .querySelector("#open-cart-button")
      .addEventListener("click", () => {
        renderCart();
        document.querySelector("#cart-form-message").textContent = "";
        cartDialog.showModal();
      });
    document
      .querySelector("#new-purchase-button")
      .addEventListener("click", () => {
        document.querySelector("#purchase-form").reset();
        document.querySelector("#purchase-form-message").textContent = "";
        purchaseDialog.showModal();
      });
    document
      .querySelector("#purchase-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const files = form.querySelector('[name="attachments"]').files;
        if (files.length > 3) {
          document.querySelector("#purchase-form-message").textContent =
            "Selecione no máximo 3 arquivos.";
          return;
        }
        try {
          const response = await fetch("/api/purchase-requests", {
              method: "POST",
              body: new FormData(form),
            }),
            body = await response.json().catch(() => ({}));
          if (!response.ok)
            throw new Error(
              body.message || "Não foi possível enviar a solicitação.",
            );
          purchaseDialog.close();
          showNotice("Solicitação de item novo enviada.");
        } catch (error) {
          document.querySelector("#purchase-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#cart-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity() || !cart.length) return;
        try {
          await Api.post("/requests/batch", {
            reason: document.querySelector("#cart-reason").value.trim(),
            items: cart.map(({ productId, quantity }) => ({
              productId,
              quantity,
            })),
          });
          cart = [];
          saveCart();
          form.reset();
          cartDialog.close();
          await refresh();
          showNotice("Pedido enviado com todos os itens.");
        } catch (error) {
          document.querySelector("#cart-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#set-request-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity() || !selectedEquipmentSet)
          return;
        try {
          await Api.post("/requests/equipment-set", {
            setId: selectedEquipmentSet.id,
            quantity: Number(
              document.querySelector("#set-request-quantity").value,
            ),
            optionalComponentIds: [
              ...document.querySelectorAll(
                "#set-request-components input:checked",
              ),
            ].map((input) => input.dataset.componentId),
            reason: document.querySelector("#set-request-reason").value.trim(),
          });
          setRequestDialog.close();
          await refresh();
          showSuccess("Solicitação do conjunto enviada com sucesso.");
        } catch (error) {
          document.querySelector("#set-request-message").textContent =
            error.message;
        }
      });
    document
      .querySelectorAll("[data-close-dialog]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          button.closest("dialog").close(),
        ),
      );
    document
      .querySelector("#logout-button")
      .addEventListener("click", async () => {
        await Api.post("/auth/logout", {});
        window.location.replace("login.html");
      });
    let searchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        productPage.page = 1;
        refresh().catch((error) => showNotice(error.message));
      }, 300);
    });
    document.querySelector("#products-prev").addEventListener("click", () => {
      productPage.page--;
      refresh();
    });
    document.querySelector("#products-next").addEventListener("click", () => {
      productPage.page++;
      refresh();
    });
  } catch (error) {
    console.error(error);
  }
})();
