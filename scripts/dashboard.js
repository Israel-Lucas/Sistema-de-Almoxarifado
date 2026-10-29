(async () => {
  try {
    const [{ user }, { units }, { inventory }] = await Promise.all([
      Api.get("/auth/me"),
      Api.get("/units"),
      Api.get("/inventory"),
    ]);
    const isMatrixMaster = user.role === "MASTER" && user.unitCode === "MATRIZ";
    const activeUnits = units.filter(
      (unit) =>
        unit.active && (user.role === "MASTER" || unit.id === user.unitId),
    );
    const activeUnitIds = new Set(activeUnits.map((unit) => unit.id));
    const visibleInventory = inventory.filter((item) =>
      activeUnitIds.has(item.unit_id),
    );
    const matrixInventory = visibleInventory.filter(
      (item) => item.unit_code === "MATRIZ",
    );
    const tableBody = document.querySelector("#inventory-table-body");
    const emptyState = document.querySelector("#inventory-empty");
    const filterDialog = document.querySelector("#filter-dialog");
    const filters = {
      unit: document.querySelector("#unit-filter"),
      status: document.querySelector("#status-filter"),
      type: document.querySelector("#type-filter"),
      model: document.querySelector("#model-filter"),
      item: document.querySelector("#item-filter"),
    };

    document.querySelector("#session-user-name").textContent = user.name;
    document.querySelector("#session-user-unit").textContent = user.unitName;
    document.querySelectorAll("[data-master-only]").forEach((element) => {
      element.hidden = user.role !== "MASTER";
    });
    document.querySelectorAll("[data-matrix-only]").forEach((element) => {
      element.hidden = !isMatrixMaster;
    });
    if (user.role !== "MASTER") {
      document.querySelector("#dashboard-title").textContent =
        `Estoque da unidade ${user.unitName}`;
      document.querySelector("#dashboard-description").textContent =
        "Veja os produtos e as quantidades disponíveis na sua unidade.";
      document.querySelector("#stock-status-heading").remove();
      document.querySelector("#status-filter-field").remove();
    }

    const addOptions = (select, entries) => {
      entries
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
        .forEach(([value, label]) => select.add(new Option(label, value)));
    };
    addOptions(
      filters.unit,
      activeUnits.map((unit) => [unit.id, unit.name]),
    );
    addOptions(filters.type, [
      ...new Map(
        visibleInventory.map((item) => [item.type_id, item.type_name]),
      ).entries(),
    ]);
    addOptions(filters.model, [
      ...new Map(
        visibleInventory.map((item) => [item.model, item.model]),
      ).entries(),
    ]);
    addOptions(filters.item, [
      ...new Map(
        visibleInventory.map((item) => [item.product_id, item.product_name]),
      ).entries(),
    ]);

    const analyticsFilters = {
      days: document.querySelector("#analytics-days"),
      unit: document.querySelector("#analytics-unit"),
      type: document.querySelector("#analytics-type"),
      product: document.querySelector("#analytics-product"),
    };
    addOptions(
      analyticsFilters.unit,
      activeUnits.map((unit) => [unit.id, unit.name]),
    );
    addOptions(analyticsFilters.type, [
      ...new Map(
        visibleInventory.map((item) => [item.type_id, item.type_name]),
      ).entries(),
    ]);
    addOptions(analyticsFilters.product, [
      ...new Map(
        visibleInventory.map((item) => [item.product_id, item.product_name]),
      ).entries(),
    ]);

    const formatDuration = (hours) => {
      const value = Number(hours || 0);
      if (!value) return "—";
      if (value < 24) return `${value.toLocaleString("pt-BR")} h`;
      return `${(value / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
    };
    const emptyChart = (container, message = "Sem dados neste período.") => {
      const empty = document.createElement("p");
      empty.className = "chart-empty";
      empty.textContent = message;
      container.appendChild(empty);
    };
    const renderRanking = (selector, entries, labelFor, valueFor) => {
      const container = document.querySelector(selector);
      container.replaceChildren();
      if (!entries.length) return emptyChart(container);
      const max = Math.max(...entries.map(valueFor), 1);
      entries.forEach((entry, index) => {
        const row = document.createElement("div");
        row.className = "ranking-row";
        const heading = document.createElement("div");
        const label = document.createElement("span");
        const value = document.createElement("strong");
        const track = document.createElement("div");
        const bar = document.createElement("i");
        label.textContent = `${index + 1}. ${labelFor(entry)}`;
        value.textContent = Number(valueFor(entry)).toLocaleString("pt-BR");
        bar.style.width = `${Math.max((valueFor(entry) / max) * 100, 3)}%`;
        heading.append(label, value);
        track.appendChild(bar);
        row.append(heading, track);
        container.appendChild(row);
      });
    };
    const renderTrend = (entries) => {
      const container = document.querySelector("#orders-chart");
      container.replaceChildren();
      if (!entries.length) return emptyChart(container);
      const max = Math.max(...entries.map((entry) => Number(entry.orders)), 1);
      entries.forEach((entry) => {
        const column = document.createElement("div");
        column.className = "chart-column";
        const plot = document.createElement("div");
        const delivered = document.createElement("i");
        const orders = document.createElement("b");
        const value = document.createElement("strong");
        const label = document.createElement("span");
        orders.style.height = `${Math.max((entry.orders / max) * 100, 5)}%`;
        delivered.style.height = `${Math.max((entry.delivered / max) * 100, entry.delivered ? 3 : 0)}%`;
        value.textContent = entry.orders;
        label.textContent = new Intl.DateTimeFormat("pt-BR", {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }).format(new Date(`${entry.period}-01T00:00:00Z`));
        plot.append(orders, delivered, value);
        column.append(plot, label);
        container.appendChild(column);
      });
    };
    const renderTable = (bodySelector, emptySelector, rows, cellsFor) => {
      const body = document.querySelector(bodySelector);
      body.replaceChildren();
      document.querySelector(emptySelector).hidden = rows.length > 0;
      rows.forEach((entry) => {
        const row = document.createElement("tr");
        cellsFor(entry).forEach((content) => {
          const cell = document.createElement("td");
          cell.textContent = content;
          row.appendChild(cell);
        });
        body.appendChild(row);
      });
    };
    const loadAnalytics = async () => {
      const query = new URLSearchParams();
      Object.entries(analyticsFilters).forEach(([key, input]) => {
        if (input?.value) query.set(key, input.value);
      });
      const data = await Api.get(`/analytics/dashboard?${query}`);
      document.querySelector("#metric-orders").textContent =
        data.summary.orders;
      document.querySelector("#metric-pending").textContent =
        data.summary.pending;
      document.querySelector("#metric-delivered").textContent =
        data.summary.delivered;
      document.querySelector("#metric-rejected").textContent =
        data.summary.rejected;
      document.querySelector("#metric-approval").textContent = formatDuration(
        data.summary.approval_hours,
      );
      document.querySelector("#metric-delivery").textContent = formatDuration(
        data.summary.delivery_hours,
      );
      renderTrend(data.trend);
      renderRanking(
        "#top-products-chart",
        data.topProducts,
        (item) => item.name,
        (item) => Number(item.requested),
      );
      renderRanking(
        "#top-kits-chart",
        data.topKits,
        (item) => item.name,
        (item) => Number(item.requested),
      );
      if (user.role === "MASTER") {
        renderRanking(
          "#top-units-chart",
          data.topUnits,
          (item) => item.name,
          (item) => Number(item.consumed),
        );
        renderRanking(
          "#movements-chart",
          data.movements,
          (item) => item.kind.replaceAll("_", " "),
          (item) => Number(item.quantity),
        );
      }
      renderTable(
        "#pending-orders-body",
        "#pending-orders-empty",
        data.oldestPending,
        (order) => [
          `#${order.order_number}`,
          order.unit_name,
          order.requested_by,
          order.items,
          order.quantity,
          formatDuration(Number(order.age_seconds) / 3600),
        ],
      );
      if (user.role === "MASTER")
        renderTable(
          "#unused-products-body",
          "#unused-products-empty",
          data.unusedProducts,
          (product) => [
            product.name,
            product.model,
            product.type_name,
            product.quantity,
          ],
        );
    };
    document
      .querySelector("#analytics-filters")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
          await loadAnalytics();
        } finally {
          button.disabled = false;
        }
      });

    const stockWithBalance = visibleInventory.filter(
      (item) => item.quantity > 0,
    );
    const uniqueProducts = new Set(
      stockWithBalance.map((item) => item.product_id),
    );
    const attentionItems = matrixInventory
      .filter((item) => item.quantity <= 5)
      .sort(
        (a, b) =>
          a.quantity - b.quantity ||
          a.product_name.localeCompare(b.product_name, "pt-BR"),
      );
    document.querySelector("#units-count").textContent = activeUnits.length;
    document.querySelector("#products-count").textContent = uniqueProducts.size;
    document.querySelector("#quantity-count").textContent = stockWithBalance
      .reduce((sum, item) => sum + item.quantity, 0)
      .toLocaleString("pt-BR");
    document.querySelector("#warning-count").textContent =
      attentionItems.length;

    if (isMatrixMaster) {
      const attentionList = document.querySelector("#attention-list");
      document.querySelector("#attention-empty").hidden =
        attentionItems.length > 0;
      attentionItems.slice(0, 8).forEach((item) => {
        const card = document.createElement("article");
        card.className = `attention-item${item.quantity === 0 ? " attention-item--empty" : ""}`;
        const info = document.createElement("div");
        const name = document.createElement("strong");
        const detail = document.createElement("span");
        const quantity = document.createElement("b");
        name.textContent = item.product_name;
        detail.textContent = `Matriz · ${item.type_name}`;
        quantity.textContent =
          item.quantity === 0
            ? "Sem estoque"
            : `${item.quantity} disponível(is)`;
        info.append(name, detail);
        card.append(info, quantity);
        attentionList.appendChild(card);
      });
    }

    const statusFor = (item) => {
      if (item.unit_code !== "MATRIZ") return ["—", "neutral", "UNMONITORED"];
      const quantity = item.quantity;
      if (quantity === 0) return ["Sem estoque", "empty", "EMPTY"];
      if (quantity <= 5) return ["Estoque baixo", "warning", "WARNING"];
      return ["Disponível", "available", "AVAILABLE"];
    };
    const render = () => {
      const filtered = visibleInventory.filter((item) => {
        const status = statusFor(item)[2];
        return (
          (!filters.unit.value || item.unit_id === filters.unit.value) &&
          (!filters.status.value || status === filters.status.value) &&
          (!filters.type.value || item.type_id === filters.type.value) &&
          (!filters.model.value || item.model === filters.model.value) &&
          (!filters.item.value || item.product_id === filters.item.value)
        );
      });
      tableBody.replaceChildren();
      emptyState.hidden = filtered.length > 0;
      filtered.forEach((item) => {
        const row = document.createElement("tr");
        [
          item.product_name,
          item.model,
          item.type_name,
          item.unit_name,
          item.quantity,
        ].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });
        if (user.role === "MASTER") {
          const [label, variant] = statusFor(item);
          const statusCell = document.createElement("td");
          if (variant === "neutral") {
            statusCell.textContent = label;
            statusCell.className = "stock-status-neutral";
          } else {
            const badge = document.createElement("span");
            badge.className = `stock-status stock-status--${variant}`;
            badge.textContent = label;
            statusCell.appendChild(badge);
          }
          row.appendChild(statusCell);
        }
        tableBody.appendChild(row);
      });
      const activeCount = Object.values(filters).filter(
        (filter) => filter.value,
      ).length;
      const countBadge = document.querySelector("#active-filter-count");
      countBadge.textContent = activeCount;
      countBadge.hidden = activeCount === 0;
    };

    document
      .querySelector("#open-filter-dialog")
      .addEventListener("click", () => filterDialog.showModal());
    document
      .querySelector("#close-filter-dialog")
      .addEventListener("click", () => filterDialog.close());
    document
      .querySelector("#filter-form")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        render();
        filterDialog.close();
      });
    const exportButton = document.querySelector("#export-inventory");
    if (exportButton)
      exportButton.addEventListener("click", () => {
        const query = new URLSearchParams({
          unit: filters.unit.value,
          situation: filters.status.value,
          type: filters.type.value,
          model: filters.model.value,
          item: filters.item.value,
        });
        location.href = `/api/exports/inventory?${query}`;
      });
    document.querySelector("#clear-filters").addEventListener("click", () => {
      Object.values(filters).forEach((filter) => {
        filter.value = "";
      });
      render();
    });
    document
      .querySelector("#logout-button")
      .addEventListener("click", async () => {
        await Api.post("/auth/logout", {});
        window.location.replace("login.html");
      });
    render();
    await loadAnalytics();
  } catch (error) {
    console.error(error);
  }
})();
