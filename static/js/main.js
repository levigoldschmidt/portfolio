(() => {
  "use strict";

  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    back: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>',
  };
  const isVideo = (src) => /\.(mp4|webm|mov)$/i.test(src);

  function onSwipe(el, handler) {
    let x0 = null;
    let y0 = null;
    el.addEventListener("touchstart", (e) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        el.dataset.swiped = String(Date.now());
        handler(dx < 0 ? 1 : -1);
      }
    });
  }
  const justSwiped = (el) => Date.now() - Number(el.dataset.swiped || 0) < 400;

  /* Lightbox: any [data-lightbox] button; items of the same group are browsed together. */
  const lightbox = (() => {
    let box, stage, counter, items = [], index = 0, opener = null;

    function build() {
      box = document.createElement("div");
      box.className = "lightbox";
      box.hidden = true;
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-label", "Visionneuse");
      box.innerHTML =
        `<button type="button" class="close" aria-label="Fermer"><span>${ICON.back}RETOUR</span></button>` +
        `<button type="button" class="arrow prev" aria-label="Image précédente">${ICON.prev}</button>` +
        `<button type="button" class="arrow next" aria-label="Image suivante">${ICON.next}</button>` +
        '<div class="stage"></div><div class="counter" aria-live="polite"></div>';
      document.body.append(box);
      stage = box.querySelector(".stage");
      counter = box.querySelector(".counter");
      box.querySelector(".close").addEventListener("click", close);
      box.querySelector(".prev").addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
      box.querySelector(".next").addEventListener("click", (e) => { e.stopPropagation(); go(1); });
      box.addEventListener("click", (e) => {
        if (!justSwiped(box) && !e.target.closest(".stage img, .stage video")) close();
      });
      onSwipe(box, go);
      document.addEventListener("keydown", (e) => {
        if (box.hidden) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowRight") go(1);
        else if (e.key === "ArrowLeft") go(-1);
        else if (e.key === "Tab") trapFocus(e);
      });
    }

    function trapFocus(e) {
      const focusable = $$("button", box);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }

    function render() {
      const item = items[index];
      stage.textContent = "";
      let media;
      if (isVideo(item.src)) {
        media = document.createElement("video");
        Object.assign(media, { src: item.src, controls: true, autoplay: true, loop: true, muted: true, playsInline: true });
      } else {
        media = document.createElement("img");
        media.src = item.src;
        media.alt = item.alt;
      }
      stage.append(media);
      const multiple = items.length > 1;
      counter.textContent = multiple ? `${index + 1} / ${items.length}` : "";
      $$(".arrow", box).forEach((a) => { a.hidden = !multiple; });
      [1, -1].forEach((d) => {
        const next = items[(index + d + items.length) % items.length];
        if (next && !isVideo(next.src)) new Image().src = next.src;
      });
    }

    function go(step) {
      if (items.length < 2) return;
      index = (index + step + items.length) % items.length;
      render();
    }

    function open(trigger) {
      if (!box) build();
      const group = trigger.dataset.lightbox;
      // Project sections render the same images twice (desktop grid + mobile carousel); browse only one copy.
      const inCarousel = Boolean(trigger.closest(".carousel"));
      const triggers = $$(`[data-lightbox="${CSS.escape(group)}"]`)
        .filter((t) => Boolean(t.closest(".carousel")) === inCarousel);
      items = triggers.map((t) => ({ src: t.dataset.src, alt: t.dataset.alt || "" }));
      index = Math.max(0, triggers.indexOf(trigger));
      opener = trigger;
      render();
      box.hidden = false;
      document.body.classList.add("no-scroll");
      box.querySelector(".close").focus();
    }

    function close() {
      box.hidden = true;
      stage.textContent = "";
      document.body.classList.remove("no-scroll");
      if (opener) opener.focus({ preventScroll: true });
    }

    return { open };
  })();

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-lightbox]");
    if (!trigger) return;
    const carousel = trigger.closest(".carousel");
    if (carousel && justSwiped(carousel)) return;
    e.preventDefault();
    lightbox.open(trigger);
  });

  /* Mobile carousels for project image sections. */
  $$(".carousel").forEach((carousel) => {
    const slides = $$(".slide", carousel);
    const counter = carousel.querySelector(".counter");
    let index = 0;
    const show = (i) => {
      slides[index].classList.remove("active");
      index = (i + slides.length) % slides.length;
      slides[index].classList.add("active");
      const img = slides[index].querySelector("img");
      if (img) img.loading = "eager";
      if (counter) counter.textContent = `${index + 1} / ${slides.length}`;
    };
    carousel.querySelector(".prev")?.addEventListener("click", () => show(index - 1));
    carousel.querySelector(".next")?.addEventListener("click", () => show(index + 1));
    if (slides.length > 1) onSwipe(carousel, (d) => show(index + d));
  });

  /* YouTube: only load the (privacy-enhanced) player after a click. */
  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-youtube]");
    if (!button) return;
    e.preventDefault();
    const params = new URLSearchParams({ autoplay: "1", rel: "0" });
    if (button.dataset.start) params.set("start", button.dataset.start);
    const iframe = document.createElement("iframe");
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(button.dataset.youtube)}?${params}`;
    iframe.title = button.getAttribute("aria-label") || "Vidéo YouTube";
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    button.replaceWith(iframe);
  });

  /* PDF viewer modal; on touch devices the browser's own viewer is used instead. */
  const pdfViewer = (() => {
    let modal, frame, download, opener = null;
    function build() {
      modal = document.createElement("div");
      modal.className = "pdf-viewer";
      modal.hidden = true;
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-label", "Lecteur PDF");
      modal.innerHTML =
        '<div class="pdf-bar"><span class="hint">DOUBLE-CLIC POUR TÉLÉCHARGER</span><div class="actions">' +
        '<a class="download" download>' +
        '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>TÉLÉCHARGER</a>' +
        '<button type="button" class="close-pdf" aria-label="Fermer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' +
        '</div></div><iframe title="Lecteur PDF"></iframe>';
      document.body.append(modal);
      frame = modal.querySelector("iframe");
      download = modal.querySelector(".download");
      modal.querySelector(".close-pdf").addEventListener("click", close);
      document.addEventListener("keydown", (e) => { if (!modal.hidden && e.key === "Escape") close(); });
    }
    function open(link) {
      if (!modal) build();
      opener = link;
      frame.src = `${link.getAttribute("href")}#toolbar=1&navpanes=1&scrollbar=1`;
      download.href = link.getAttribute("href");
      download.setAttribute("download", link.dataset.name || "");
      modal.hidden = false;
      document.body.classList.add("no-scroll");
      modal.querySelector(".close-pdf").focus();
    }
    function close() {
      modal.hidden = true;
      frame.src = "about:blank";
      document.body.classList.remove("no-scroll");
      if (opener) opener.focus({ preventScroll: true });
    }
    return { open };
  })();

  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-pdf]");
    if (!link || coarsePointer || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    pdfViewer.open(link);
  });
  // Double-clicking a file row downloads it.
  document.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".file");
    if (row && !e.target.closest("a")) row.querySelector("a[download]")?.click();
  });

  /* Section sub-navigation: highlight the current section and mirror it in the header once scrolled. */
  const subnav = document.querySelector(".subnav");
  const header = document.querySelector(".site-header");
  if (subnav && header) {
    const links = $$("a", subnav);
    const headerNav = document.createElement("nav");
    headerNav.className = "header-subnav";
    headerNav.setAttribute("aria-label", "Sections");
    links.forEach((a) => headerNav.append(a.cloneNode(true)));
    header.querySelector(".inner").append(headerNav);
    const allLinks = [...links, ...$$("a", headerNav)];
    const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);

    let ticking = false;
    const update = () => {
      ticking = false;
      header.classList.toggle("show-subnav", subnav.getBoundingClientRect().bottom < header.offsetHeight);
      const line = header.offsetHeight + 40;
      let current = sections[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = sections[sections.length - 1];
      }
      allLinks.forEach((a) => {
        const active = current && a.hash === `#${current.id}`;
        a.classList.toggle("active", active);
        if (active) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
