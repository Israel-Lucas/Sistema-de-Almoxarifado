(async () => {
  const actions = document.querySelector(".topbar__actions");
  if (!actions) return;
  const wrapper = document.createElement("div");
  wrapper.className = "notifications";
  wrapper.innerHTML = `<button class="notifications__button" type="button" aria-label="Notificações" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="notifications__badge" hidden>0</span></button><section class="notifications__panel" hidden><header><strong>Notificações</strong><button type="button" aria-label="Fechar">×</button></header><div class="notifications__list"></div><p class="notifications__empty" hidden>Nenhuma notificação.</p></section>`;
  actions.prepend(wrapper);
  const button = wrapper.querySelector(".notifications__button"),
    badge = wrapper.querySelector(".notifications__badge"),
    panel = wrapper.querySelector(".notifications__panel"),
    list = wrapper.querySelector(".notifications__list"),
    empty = wrapper.querySelector(".notifications__empty");
  let readTimer;
  const cancelReadTimer = () => {
    clearTimeout(readTimer);
    readTimer = undefined;
  };
  const markAsReadAfterViewing = () => {
    cancelReadTimer();
    readTimer = setTimeout(async () => {
      if (panel.hidden) return;
      try {
        await Api.post("/notifications/read-all", {});
        badge.hidden = true;
        list
          .querySelectorAll(".is-unread")
          .forEach((item) => item.classList.remove("is-unread"));
      } catch (error) {
        console.error(error);
      }
    }, 1000);
  };
  const render = (notifications) => {
    list.replaceChildren();
    empty.hidden = notifications.length > 0;
    notifications.forEach((item) => {
      const element = document.createElement(item.link ? "a" : "article");
      element.className = `notifications__item${item.read_at ? "" : " is-unread"}`;
      if (item.link) element.href = item.link;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const message = document.createElement("p");
      message.textContent = item.message;
      const date = document.createElement("time");
      date.dateTime = item.created_at;
      date.textContent = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(item.created_at));
      element.append(title, message, date);
      list.appendChild(element);
    });
  };
  const refresh = async () => {
    try {
      const data = await Api.get("/notifications");
      badge.textContent = data.unread > 99 ? "99+" : data.unread;
      badge.hidden = data.unread === 0;
      render(data.notifications);
    } catch (error) {
      console.error(error);
    }
  };
  button.addEventListener("click", async () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
    if (opening) {
      await refresh();
      markAsReadAfterViewing();
    } else cancelReadTimer();
  });
  wrapper
    .querySelector(".notifications__panel header button")
    .addEventListener("click", () => {
      panel.hidden = true;
      cancelReadTimer();
      button.setAttribute("aria-expanded", "false");
    });
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) {
      panel.hidden = true;
      cancelReadTimer();
      button.setAttribute("aria-expanded", "false");
    }
  });
  await refresh();
  setInterval(refresh, 30_000);
})();
