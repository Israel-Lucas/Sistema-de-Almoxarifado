(async () => {
  let user,
    users = [],
    units = [];
  const userDialog = document.querySelector("#user-dialog"),
    unitDialog = document.querySelector("#unit-dialog"),
    unitEditDialog = document.querySelector("#unit-edit-dialog"),
    tableBody = document.querySelector("#users-table-body"),
    searchInput = document.querySelector("#user-search"),
    notice = document.querySelector("#page-notice");
  const showNotice = (message) => {
    notice.textContent = message;
    notice.classList.add("is-visible");
    setTimeout(() => notice.classList.remove("is-visible"), 2500);
  };
  const refresh = async () => {
    [{ users }, { units }] = await Promise.all([
      Api.get("/users"),
      Api.get("/units"),
    ]);
    renderUsers();
  };
  const fillUnits = () => {
    const select = document.querySelector("#user-unit");
    select.replaceChildren();
    units
      .filter((unit) => unit.active)
      .forEach((unit) => select.add(new Option(unit.name, unit.id)));
  };
  const updateEmailRequirement = () => {
    const isMatrix =
      units.find(
        (unit) => unit.id === document.querySelector("#user-unit").value,
      )?.code === "MATRIZ";
    const required =
      document.querySelector("#user-role").value === "MASTER" && isMatrix;
    document.querySelector("#user-email").required = required;
    document.querySelector("#email-requirement").textContent = required
      ? "(obrigatório para master da Matriz)"
      : "(opcional)";
  };
  const openUser = (selected = null) => {
    document.querySelector("#user-form").reset();
    fillUnits();
    document.querySelector("#editing-user-id").value = selected?.id || "";
    document.querySelector("#user-dialog-title").textContent = selected
      ? "Editar usuário"
      : "Adicionar usuário";
    document.querySelector("#password-label").textContent = selected
      ? "Nova senha (opcional)"
      : "Senha";
    document.querySelector("#user-password").required = !selected;
    document.querySelector("#user-form-message").textContent = "";
    if (selected) {
      document.querySelector("#user-name").value = selected.name;
      document.querySelector("#user-username").value = selected.username;
      document.querySelector("#user-email").value = selected.email || "";
      document.querySelector("#user-role").value = selected.role;
      document.querySelector("#user-unit").value = selected.unit_id;
      document.querySelector("#user-active").checked = selected.active;
    }
    updateEmailRequirement();
    userDialog.showModal();
  };
  const renderUsers = () => {
    const query = searchInput.value.trim().toLocaleUpperCase("pt-BR"),
      filtered = users.filter((item) =>
        `${item.name} ${item.username} ${item.email || ""}`
          .toLocaleUpperCase("pt-BR")
          .includes(query),
      );
    tableBody.replaceChildren();
    document.querySelector("#users-empty").hidden = filtered.length > 0;
    filtered.forEach((item) => {
      const row = document.createElement("tr");
      [item.name, item.username, item.email || "—"].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      const role = document.createElement("td");
      role.innerHTML = `<span class="user-badge user-badge--${item.role === "MASTER" ? "master" : "user"}">${item.role === "MASTER" ? "Master" : "Usuário"}</span>`;
      row.appendChild(role);
      const unit = document.createElement("td");
      unit.textContent = item.unit_name;
      row.appendChild(unit);
      const status = document.createElement("td");
      status.innerHTML = `<span class="user-badge user-badge--${item.active ? "active" : "inactive"}">${item.active ? "Ativo" : "Inativo"}</span>`;
      row.appendChild(status);
      const action = document.createElement("td"),
        edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-user-button";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => openUser(item));
      action.appendChild(edit);
      if (user.unitCode === "MATRIZ" && item.id !== user.id) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-user-button";
        remove.textContent = "Excluir";
        remove.addEventListener("click", async () => {
          if (
            !confirm(
              `EXCLUIR o usuário “${item.name}” (${item.username})? O acesso será removido definitivamente.`,
            )
          )
            return;
          try {
            await Api.delete(`/users/${item.id}`, {});
            await refresh();
            showNotice("Usuário excluído.");
          } catch (error) {
            showNotice(error.message);
          }
        });
        action.appendChild(remove);
      }
      row.appendChild(action);
      tableBody.appendChild(row);
    });
  };
  const renderUnits = () => {
    const container = document.querySelector("#units-list");
    container.replaceChildren();
    units.forEach((item) => {
      const row = document.createElement("div");
      row.className = "management-list__item";
      const name = document.createElement("span");
      name.textContent = `${item.name} (${item.code})${item.active ? "" : " — desativada"}`;
      const actions = document.createElement("div");
      actions.className = "management-list__actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "management-list__toggle";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => {
        document.querySelector("#unit-edit-form").reset();
        document.querySelector("#editing-unit-id").value = item.id;
        document.querySelector("#editing-unit-name").value = item.name;
        document.querySelector("#editing-unit-code").textContent = item.code;
        document.querySelector("#unit-edit-message").textContent = "";
        unitEditDialog.showModal();
        document.querySelector("#editing-unit-name").focus();
      });
      actions.appendChild(edit);
      if (!item.protected) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "management-list__toggle";
        toggle.textContent = item.active ? "Desativar" : "Ativar";
        toggle.addEventListener("click", async () => {
          if (
            !confirm(
              `${item.active ? "DESATIVAR" : "ATIVAR"} a unidade “${item.name}”?`,
            )
          )
            return;
          try {
            await Api.patch(`/units/${item.id}/active`, {
              active: !item.active,
            });
            await refresh();
            renderUnits();
          } catch (error) {
            document.querySelector("#unit-form-message").textContent =
              error.message;
          }
        });
        actions.appendChild(toggle);
        if (user.unitCode === "MATRIZ") {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "management-list__delete";
          remove.textContent = "Excluir";
          remove.addEventListener("click", async () => {
            if (
              !confirm(
                `EXCLUIR definitivamente a unidade “${item.name}”? Unidades com usuários, estoque ou pedidos não podem ser excluídas.`,
              )
            )
              return;
            try {
              await Api.delete(`/units/${item.id}`, {});
              await refresh();
              renderUnits();
            } catch (error) {
              document.querySelector("#unit-form-message").textContent =
                error.message;
            }
          });
          actions.appendChild(remove);
        }
      } else {
        const label = document.createElement("small");
        label.textContent = "Protegida";
        actions.appendChild(label);
      }
      row.append(name, actions);
      container.appendChild(row);
    });
  };
  try {
    ({ user } = await Api.get("/auth/me"));
    if (user.role !== "MASTER") {
      location.replace("dashboard.html");
      return;
    }
    document
      .querySelector("#unit-edit-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!event.currentTarget.reportValidity()) return;
        const id = document.querySelector("#editing-unit-id").value;
        const name = document.querySelector("#editing-unit-name").value.trim();
        try {
          await Api.put(`/units/${id}`, { name });
          unitEditDialog.close();
          await refresh();
          renderUnits();
          showNotice("Nome da unidade atualizado.");
        } catch (error) {
          document.querySelector("#unit-edit-message").textContent =
            error.message;
        }
      });
    document
      .querySelectorAll("[data-close-unit-edit]")
      .forEach((button) =>
        button.addEventListener("click", () => unitEditDialog.close()),
      );
    document.querySelector("#session-user-name").textContent = user.name;
    document.querySelector("#session-user-unit").textContent = user.unitName;
    await refresh();
    document
      .querySelector("#user-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        const id = document.querySelector("#editing-user-id").value,
          password = document.querySelector("#user-password").value;
        const data = {
          name: document.querySelector("#user-name").value.trim(),
          username: document.querySelector("#user-username").value.trim(),
          email: document.querySelector("#user-email").value.trim(),
          role: document.querySelector("#user-role").value,
          unitId: document.querySelector("#user-unit").value,
          active: document.querySelector("#user-active").checked,
        };
        if (password) data.password = password;
        try {
          if (id) await Api.put(`/users/${id}`, data);
          else await Api.post("/users", { ...data, password });
          userDialog.close();
          await refresh();
          showNotice(id ? "Usuário atualizado." : "Usuário criado.");
        } catch (error) {
          document.querySelector("#user-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#unit-form")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!form.reportValidity()) return;
        try {
          await Api.post("/units", {
            name: document.querySelector("#unit-name").value.trim(),
          });
          form.reset();
          await refresh();
          renderUnits();
          document.querySelector("#unit-name").focus();
          document.querySelector("#unit-form-message").textContent = "";
        } catch (error) {
          document.querySelector("#unit-form-message").textContent =
            error.message;
        }
      });
    document
      .querySelector("#user-role")
      .addEventListener("change", updateEmailRequirement);
    document
      .querySelector("#user-unit")
      .addEventListener("change", updateEmailRequirement);
    document
      .querySelector("#add-user-button")
      .addEventListener("click", () => openUser());
    document
      .querySelector("#manage-units-button")
      .addEventListener("click", () => {
        document.querySelector("#unit-form").reset();
        document.querySelector("#unit-form-message").textContent = "";
        renderUnits();
        unitDialog.showModal();
      });
    document
      .querySelector("#close-user-dialog")
      .addEventListener("click", () => userDialog.close());
    document
      .querySelector("#cancel-user-dialog")
      .addEventListener("click", () => userDialog.close());
    document
      .querySelector("#close-unit-dialog")
      .addEventListener("click", () => unitDialog.close());
    document
      .querySelector("#finish-unit-dialog")
      .addEventListener("click", () => unitDialog.close());
    document
      .querySelector("#logout-button")
      .addEventListener("click", async () => {
        await Api.post("/auth/logout", {});
        location.replace("login.html");
      });
    searchInput.addEventListener("input", renderUsers);
  } catch (error) {
    showNotice(error.message);
  }
})();
