const SYMBOLS = { ticket: "▥", leaf: "❧", thread: "⌁", paper: "▱" };
const PLACES = { threshold: "入口", studio: "作業机", archive: "棚" };
const SPOTS = { window: "窓辺", center: "真ん中", near: "手前" };
const ERRORS = {
  workshop_materials_full: "置けるものは16個まで。今あるものを使って過ごそう。",
  workshop_text_invalid: "紙片には1〜160文字で書いてください。",
  workshop_material_missing: "その素材が見つかりません。画面を開き直してください。",
  workshop_page_missing: "そのページが見つかりません。ノートを開き直してください。",
  workshop_gift_missing: "そのカードが見つかりません。画面を開き直してください。",
  state_conflict: "ハチカも動いているみたい。もう一度試してください。",
};

export function createWorkshopView({ request, onUpdate, flash }) {
  const stage = document.getElementById("avatar-stage");
  const materialsNode = document.getElementById("room-materials");
  const eventsNode = document.getElementById("workshop-events");
  const paperDialog = document.getElementById("paper-dialog");
  const materialDialog = document.getElementById("material-dialog");
  const notebookDialog = document.getElementById("notebook-dialog");
  const bookmarkButton = document.getElementById("bookmark-button");
  const giftDialog = document.getElementById("gift-dialog");
  const keepsakesDialog = document.getElementById("keepsakes-dialog");
  const giftReceiveButton = document.getElementById("gift-receive");
  const deskGiftsNode = document.getElementById("desk-gifts");
  let ui = null;
  let room = "studio";
  let deskSpot = "center";
  let busy = false;
  let selectedMaterialId = null;
  let selectedPageId = null;
  let selectedGiftId = null;
  let renderedMaterials = "";
  let renderedEvents = "";
  let renderedPage = "";
  let renderedGifts = "";
  let renderedKeepsakes = "";
  let renderedGift = "";

  async function interact(action) {
    if (busy) return false;
    busy = true;
    updateDisabled();
    try {
      const payload = await request("/api/workshop/interact", {
        method: "POST",
        body: JSON.stringify({ interactionId: window.crypto.randomUUID(), action }),
      });
      onUpdate(payload.ui);
      flash(payload.message || "工房に残した。");
      return true;
    } catch (error) {
      flash(ERRORS[error.message] || "工房に届かなかった。もう一度試してください。", "error");
      return false;
    } finally {
      busy = false;
      updateDisabled();
    }
  }

  function updateDisabled() {
    document.querySelectorAll("[data-offer], [data-material-spot], #paper-form button[type=submit], #material-move").forEach((node) => { node.disabled = busy; });
    bookmarkButton.disabled = busy || !ui?.workshop.pages.length;
    giftReceiveButton.disabled = busy;
  }

  function render(nextUi) {
    ui = nextUi;
    if (!ui.workshop) return;
    const workshop = ui.workshop;
    stage.dataset.place = room;
    stage.dataset.agentHere = String(ui.embodiment.place === room);
    stage.dataset.lamp = workshop.lamp;
    document.querySelectorAll("[data-room]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.room === room));
    });
    document.getElementById("room-presence").textContent = ui.embodiment.place === room ? "ハチカがいる" : `ハチカは${PLACES[ui.embodiment.place] ?? "別の場所"}に`;
    document.getElementById("notebook-count").textContent = workshop.pages.length;
    document.getElementById("workshop-status").textContent = workshop.status;
    document.querySelectorAll("[data-desk-spot]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.deskSpot === deskSpot)));
    document.getElementById("desk-placement-hint").textContent = room === "archive" ? "棚に置いた素材は、しまっておける" : `${SPOTS[deskSpot]}に置く · 素材を手に取って、並びを変えられる`;
    document.getElementById("keepsakes-count").textContent = workshop.gifts.filter((gift) => gift.receivedAt).length;
    const materials = workshop.materials.filter((item) => item.place === room);
    const materialSignature = JSON.stringify({ room, materials });
    if (renderedMaterials !== materialSignature) {
      renderedMaterials = materialSignature;
      materialsNode.replaceChildren(...(room === "archive" ? materials.map(materialButton) : []));
      document.querySelectorAll("[data-spot-items]").forEach((node) => {
        node.replaceChildren(...(room === "studio" ? materials.filter((item) => item.spot === node.dataset.spotItems).map(materialButton) : []));
      });
    }
    const pending = workshop.gifts.filter((gift) => !gift.receivedAt);
    const giftSignature = JSON.stringify(pending);
    if (renderedGifts !== giftSignature) {
      renderedGifts = giftSignature;
      deskGiftsNode.replaceChildren(...pending.map((gift) => {
        const button = giftButton(gift);
        button.classList.add("desk-gift");
        button.setAttribute("aria-label", `ハチカからのカードを手に取る：${gift.title}`);
        return button;
      }));
    }
    const events = workshop.events.slice(-3);
    const eventSignature = JSON.stringify(events);
    if (renderedEvents !== eventSignature) {
      renderedEvents = eventSignature;
      eventsNode.replaceChildren(...events.map((event) => {
        const item = document.createElement("li");
        const actor = document.createElement("span");
        actor.textContent = event.actor === "hachika" ? "ハチカ" : "あなた";
        item.append(actor, document.createTextNode(event.text));
        return item;
      }));
    }
    if (notebookDialog.open) renderNotebook();
    if (materialDialog.open) renderMaterial();
    if (giftDialog.open) renderGift();
    if (keepsakesDialog.open) renderKeepsakes();
    updateDisabled();
  }

  function materialButton(material) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "room-material";
    button.dataset.kind = material.kind;
    button.dataset.noticed = String(material.noticedAt !== null);
    button.setAttribute("aria-label", `${material.label}を手に取る`);
    button.draggable = true;
    button.title = material.place === "studio" ? `${SPOTS[material.spot]} · 手に取る、またはドラッグで動かす` : "棚にしまってある";
    const symbol = document.createElement("span");
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = SYMBOLS[material.kind] ?? "▱";
    const label = document.createElement("span");
    label.textContent = material.label;
    button.append(symbol, label);
    button.addEventListener("click", () => {
      selectedMaterialId = material.id;
      renderMaterial();
      materialDialog.showModal();
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", material.id);
      event.dataTransfer.effectAllowed = "move";
    });
    return button;
  }

  function renderMaterial() {
    const material = ui.workshop.materials.find((item) => item.id === selectedMaterialId);
    if (!material) { materialDialog.close(); return; }
    document.getElementById("material-title").textContent = material.label;
    document.getElementById("material-text").textContent = material.text;
    document.getElementById("material-handling").textContent = material.uses > 0 ? "ハチカのノートにも、この断片が残っている。" : material.noticedAt ? "ハチカが手に取って、眺めていた。" : "まだ、置いたときのまま。";
    document.getElementById("material-move").textContent = material.place === "studio" ? "棚にしまう" : "机へ戻す";
    document.querySelectorAll("[data-material-spot]").forEach((button) => {
      button.setAttribute("aria-pressed", String(material.place === "studio" && material.spot === button.dataset.materialSpot));
    });
  }

  function giftButton(gift) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gift-card-button";
    const label = document.createElement("span");
    label.className = "gift-card-label";
    label.textContent = gift.receivedAt ? "手元のカード" : "ハチカから";
    const title = document.createElement("span");
    title.textContent = gift.title;
    button.append(label, title);
    button.title = gift.title;
    button.addEventListener("click", () => {
      if (keepsakesDialog.open) keepsakesDialog.close();
      selectedGiftId = gift.id;
      renderedGift = "";
      renderGift();
      giftDialog.showModal();
    });
    return button;
  }

  function renderGift() {
    const gift = ui.workshop.gifts.find((item) => item.id === selectedGiftId);
    if (!gift) { giftDialog.close(); return; }
    const page = ui.workshop.pages.find((item) => item.id === gift.pageId);
    const signature = JSON.stringify({ gift, fragments: page?.fragments });
    if (renderedGift !== signature) {
      renderedGift = signature;
      document.getElementById("gift-title").textContent = gift.title;
      document.getElementById("gift-note").textContent = gift.note;
      document.getElementById("gift-fragments").replaceChildren(...(page?.fragments ?? []).map((fragment) => {
        const figure = document.createElement("figure");
        figure.className = "gift-fragment";
        figure.dataset.kind = fragment.kind;
        const symbol = document.createElement("span");
        symbol.textContent = SYMBOLS[fragment.kind] ?? "▱";
        symbol.setAttribute("aria-hidden", "true");
        const text = document.createElement("figcaption");
        text.textContent = fragment.excerpt ?? fragment.text;
        figure.append(symbol, text);
        return figure;
      }));
      document.getElementById("gift-origin").textContent = `ノート「${page?.title ?? ""}」から。${gift.receivedAt ? "受け取って、手元に残している。" : "ハチカが机の手前に残している。"}`;
    }
    giftReceiveButton.hidden = Boolean(gift.receivedAt);
    const download = document.getElementById("gift-download");
    download.hidden = !gift.receivedAt;
    download.href = `/api/workshop/gifts/${encodeURIComponent(gift.id)}`;
    download.download = `hachika-card-${gift.id}.md`;
    updateDisabled();
  }

  function renderKeepsakes() {
    const gifts = ui.workshop.gifts.filter((gift) => gift.receivedAt).reverse();
    const signature = JSON.stringify(gifts);
    if (renderedKeepsakes !== signature) {
      renderedKeepsakes = signature;
      const list = document.getElementById("keepsakes-list");
      list.replaceChildren(...gifts.map(giftButton));
      if (!gifts.length) {
        const empty = document.createElement("p");
        empty.textContent = "まだ、手元は空っぽ。机の手前にカードがあったら、手に取ってみて。";
        list.append(empty);
      }
    }
    document.getElementById("keepsakes-download").hidden = !gifts.length;
  }

  function openNotebook() {
    selectedPageId = ui?.workshop.pages.at(-1)?.id ?? null;
    renderedPage = "";
    renderNotebook();
    notebookDialog.showModal();
  }

  function renderNotebook() {
    const pages = ui?.workshop.pages ?? [];
    const selected = pages.findIndex((item) => item.id === selectedPageId);
    const index = selected < 0 ? Math.max(0, pages.length - 1) : selected;
    const page = pages[index];
    selectedPageId = page?.id ?? null;
    const signature = JSON.stringify(page ?? null);
    const pageNode = document.getElementById("notebook-page");
    if (renderedPage !== signature) {
      renderedPage = signature;
      pageNode.replaceChildren();
      pageNode.dataset.composition = page?.composition ?? "empty";
      pageNode.dataset.bookmarked = String(page?.bookmarked ?? false);
      const title = document.createElement("h3");
      title.textContent = page?.title ?? "まだ、白いページ。";
      pageNode.append(title);
      if (page) {
        const collage = document.createElement("div");
        collage.className = "notebook-collage";
        collage.dataset.layout = page.making?.program.layout ?? "scatter";
        for (const fragment of page.fragments) {
          const card = document.createElement("figure");
          card.dataset.kind = fragment.kind;
          const symbol = document.createElement("span");
          symbol.className = "fragment-symbol";
          symbol.setAttribute("aria-hidden", "true");
          symbol.textContent = SYMBOLS[fragment.kind] ?? "▱";
          const caption = document.createElement("figcaption");
          caption.textContent = fragment.excerpt ?? fragment.text;
          card.append(symbol, caption);
          collage.append(card);
        }
        const text = document.createElement("p");
        text.className = "notebook-caption";
        text.textContent = page.text;
        pageNode.append(collage, text);
        if (page.making) {
          const making = document.createElement("p");
          making.className = "notebook-making";
          making.textContent = `「${page.making.recipeName}」${page.making.origin === "reused" ? "覚えた作り方で、もう一度。" : "このページから覚えた、新しい作り方。"}`;
          pageNode.append(making);
        }
      } else {
        const text = document.createElement("p");
        text.textContent = "机に素材を置いて、しばらく過ごしてみて。ハチカが手に取ると、ここに残るものができる。";
        pageNode.append(text);
      }
    }
    document.getElementById("notebook-pagination").textContent = pages.length ? `${index + 1} / ${pages.length}` : "0 / 0";
    document.getElementById("notebook-prev").disabled = index <= 0;
    document.getElementById("notebook-next").disabled = index >= pages.length - 1;
    bookmarkButton.textContent = page?.bookmarked ? "しおりを外す" : "しおりを挟む";
    bookmarkButton.setAttribute("aria-pressed", String(page?.bookmarked ?? false));
    document.getElementById("notebook-download").hidden = !pages.length;
    updateDisabled();
  }

  document.querySelectorAll("[data-room]").forEach((button) => {
    button.addEventListener("click", () => { room = button.dataset.room; if (ui) render(ui); });
    button.addEventListener("dragover", (event) => { if (button.dataset.room !== "threshold") event.preventDefault(); });
    button.addEventListener("drop", async (event) => {
      event.preventDefault();
      const place = button.dataset.room;
      if (place === "threshold") return;
      const materialId = event.dataTransfer.getData("text/plain");
      if (!ui.workshop.materials.some((item) => item.id === materialId)) return;
      if (await interact({ kind: "move", materialId, place })) { room = place; render(ui); }
    });
  });
  document.querySelectorAll("[data-offer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const place = room === "archive" ? "archive" : "studio";
      if (await interact({ kind: "offer", material: button.dataset.offer, place, spot: deskSpot })) { room = place; render(ui); }
    });
  });
  document.querySelectorAll("[data-desk-spot]").forEach((button) => {
    button.addEventListener("click", () => { deskSpot = button.dataset.deskSpot; if (ui) render(ui); });
  });
  document.querySelectorAll("[data-desk-zone]").forEach((zone) => {
    zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drag-target"); });
    zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("drag-target"); });
    zone.addEventListener("drop", async (event) => {
      event.preventDefault();
      zone.classList.remove("drag-target");
      const materialId = event.dataTransfer.getData("text/plain");
      if (!ui.workshop.materials.some((item) => item.id === materialId)) return;
      const spot = zone.dataset.deskZone;
      if (await interact({ kind: "move", materialId, place: "studio", spot })) { deskSpot = spot; render(ui); }
    });
  });
  document.querySelectorAll("[data-material-spot]").forEach((button) => {
    button.addEventListener("click", async () => {
      const spot = button.dataset.materialSpot;
      if (await interact({ kind: "move", materialId: selectedMaterialId, place: "studio", spot })) {
        materialDialog.close(); room = "studio"; deskSpot = spot; render(ui);
      }
    });
  });
  function openPaper() { paperDialog.showModal(); document.getElementById("paper-text").focus(); }
  document.getElementById("paper-button").addEventListener("click", openPaper);
  document.querySelector(".object-desk").addEventListener("click", openPaper);
  document.getElementById("paper-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.getElementById("paper-text");
    if (await interact({ kind: "offer", material: "paper", text: input.value.trim(), place: "studio", spot: deskSpot })) {
      paperDialog.close(); input.value = ""; room = "studio"; render(ui);
    }
  });
  document.getElementById("material-move").addEventListener("click", async () => {
    const material = ui.workshop.materials.find((item) => item.id === selectedMaterialId);
    if (!material) return;
    if (await interact({ kind: "move", materialId: material.id, place: material.place === "studio" ? "archive" : "studio" })) {
      materialDialog.close(); room = material.place === "studio" ? "archive" : "studio"; render(ui);
    }
  });
  document.querySelector(".object-lamp").addEventListener("click", () => {
    if (ui) void interact({ kind: "light", lamp: ui.workshop.lamp === "warm" ? "dim" : "warm" });
  });
  document.getElementById("notebook-button").addEventListener("click", openNotebook);
  document.querySelector(".object-shelf").addEventListener("click", openNotebook);
  for (const [id, offset] of [["notebook-prev", -1], ["notebook-next", 1]]) {
    document.getElementById(id).addEventListener("click", () => {
      const pages = ui.workshop.pages;
      const index = pages.findIndex((page) => page.id === selectedPageId);
      selectedPageId = pages[index + offset]?.id ?? selectedPageId;
      renderNotebook();
    });
  }
  bookmarkButton.addEventListener("click", () => {
    const page = ui.workshop.pages.find((item) => item.id === selectedPageId);
    if (page) void interact({ kind: "bookmark", pageId: page.id, bookmarked: !page.bookmarked });
  });
  giftReceiveButton.addEventListener("click", async () => {
    if (await interact({ kind: "receive", giftId: selectedGiftId })) document.getElementById("gift-download").focus();
  });
  document.getElementById("keepsakes-button").addEventListener("click", () => { renderKeepsakes(); keepsakesDialog.showModal(); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });
  return { render };
}
