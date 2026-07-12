/* =====================================================
   SearchSelect — wraps a native <select> with a
   searchable, accessible dropdown. Works with Arabic.
   The underlying <select> stays the source of truth so
   FormData / form submit logic continues to work.
===================================================== */

(function (global) {
  const KEYS = { ENTER:13, ESC:27, UP:38, DOWN:40, TAB:9 };

  class SearchSelect {
    constructor(selectEl){
      this.select = selectEl;
      // Expose this instance on the underlying <select> so external code
      // (e.g. filter-clear handlers) can re-sync after programmatic changes.
      this.select._ss = this;
      this.placeholder = "— Select —";
      // Drop the native required attribute (we'll validate via the underlying value).
      this.select.removeAttribute("required");
      this.select.classList.add("ss-native");
      this.build();
      this.sync();
      this.bindObservers();
      this.bindOuter();
    }

    /* ---------- DOM construction ---------- */
    build(){
      this.wrapper = document.createElement("div");
      this.wrapper.className = "ss-wrapper";

      this.trigger = document.createElement("button");
      this.trigger.type = "button";
      this.trigger.className = "ss-trigger";
      this.trigger.setAttribute("aria-haspopup", "listbox");
      this.trigger.setAttribute("aria-expanded", "false");

      this.triggerLabel = document.createElement("span");
      this.triggerLabel.className = "ss-trigger-label";

      const caret = document.createElement("span");
      caret.className = "ss-caret";
      caret.textContent = "▾";

      this.trigger.appendChild(this.triggerLabel);
      this.trigger.appendChild(caret);

      this.panel = document.createElement("div");
      this.panel.className = "ss-panel";

      this.search = document.createElement("input");
      this.search.type = "text";
      this.search.className = "ss-search";
      this.search.setAttribute("autocomplete", "off");
      this.search.setAttribute("spellcheck", "false");

      this.list = document.createElement("div");
      this.list.className = "ss-list";
      this.list.setAttribute("role", "listbox");

      this.empty = document.createElement("div");
      this.empty.className = "ss-empty";
      this.empty.hidden = true;

      this.panel.appendChild(this.search);
      this.panel.appendChild(this.list);
      this.panel.appendChild(this.empty);

      this.wrapper.appendChild(this.trigger);
      this.wrapper.appendChild(this.panel);

      this.select.parentNode.insertBefore(this.wrapper, this.select);
      this.wrapper.appendChild(this.select); // move native select inside wrapper (kept hidden by CSS)

      this.trigger.addEventListener("click", () => this.toggle());
      this.search.addEventListener("input", () => this.filter());
      this.search.addEventListener("keydown", (e) => this.onKey(e));
    }

    bindObservers(){
      // re-sync items when the underlying <select> is repopulated by fillSelect()
      this.observer = new MutationObserver(() => this.sync());
      this.observer.observe(this.select, { childList: true, subtree: true, characterData: true });
    }

    bindOuter(){
      document.addEventListener("click", (e) => {
        if (!this.wrapper.contains(e.target)) this.close();
      });
      document.addEventListener("lang:changed", () => this.refreshLabels());
    }

    /* ---------- state ---------- */
    sync(){
      const opts = Array.from(this.select.options);
      this.list.innerHTML = "";

      // capture placeholder text from the disabled option, if any
      const ph = opts.find(o => o.disabled && (o.value === "" || o.selected));
      if (ph && ph.textContent) this.placeholder = ph.textContent;

      const addOption = (o) => {
        if (o.disabled && o.value === "") return; // skip placeholder
        const item = document.createElement("div");
        item.className = "ss-item" + (o.value === this.select.value ? " active" : "");
        item.setAttribute("role", "option");
        item.dataset.value = o.value;
        item.textContent = o.textContent;
        item.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus
        item.addEventListener("click", () => this.choose(o.value));
        this.list.appendChild(item);
      };

      // Walk direct children so <optgroup> labels become styled section headers
      // (e.g. the car-model picker grouped by manufacturer). Selects without
      // optgroups render exactly as before.
      Array.from(this.select.children).forEach(node => {
        if (node.tagName === "OPTGROUP"){
          const header = document.createElement("div");
          header.className = "ss-group";
          header.textContent = node.label || "";
          this.list.appendChild(header);
          Array.from(node.children).forEach(addOption);
        } else if (node.tagName === "OPTION"){
          addOption(node);
        }
      });

      this.refreshLabels();
      this.filter();
    }

    refreshLabels(){
      const opt = this.select.options[this.select.selectedIndex];
      // A real choice is any selected option that isn't the placeholder
      // (placeholders are the disabled+hidden option). This lets a legitimate
      // empty-value choice — e.g. the branch picker's "Main (head office)" —
      // show its label in the normal ink colour instead of the muted
      // "— Select —" placeholder.
      const hasValue = !!opt && !opt.disabled && !opt.hidden;
      this.triggerLabel.textContent = hasValue ? opt.textContent : this.placeholder;
      this.trigger.classList.toggle("placeholder", !hasValue);
      // refresh search placeholder via global t() if available
      if (typeof t === "function") {
        this.search.placeholder = t("ss.search");
        this.empty.textContent  = t("ss.empty");
      } else {
        this.search.placeholder = "Search…";
        this.empty.textContent  = "No matches";
      }
    }

    choose(value){
      this.select.value = value;
      this.select.dispatchEvent(new Event("change", { bubbles: true }));
      this.sync();
      this.close();
    }

    /* ---------- panel ---------- */
    open(){
      // close every other open panel
      document.querySelectorAll(".ss-wrapper.open").forEach(w => {
        if (w !== this.wrapper) w.classList.remove("open");
      });
      this.wrapper.classList.add("open");
      this.trigger.setAttribute("aria-expanded", "true");
      this.search.value = "";
      this.filter();
      // focus search after panel is in the layout
      setTimeout(() => this.search.focus(), 0);
    }

    close(){
      this.wrapper.classList.remove("open");
      this.trigger.setAttribute("aria-expanded", "false");
    }

    toggle(){
      if (this.wrapper.classList.contains("open")) this.close();
      else this.open();
    }

    /* ---------- search & keyboard ---------- */
    filter(){
      const q       = this.search.value.trim().toLocaleLowerCase();
      const prefMin = Number(this.select.dataset.ssPrefix) || 0;  // 0 = off
      // Prefix mode: only filter once the user has typed >= prefMin chars,
      // and match by startsWith. Below the threshold, show every option so
      // the admin can still scroll-pick.
      const useFilter = q.length >= (prefMin || 1);

      const children = Array.from(this.list.children);
      let visible = 0;
      children.forEach(item => {
        if (item.classList.contains("ss-group")) return; // headers handled below
        const txt = item.textContent.toLocaleLowerCase();
        let show;
        if (!q) show = true;
        else if (!useFilter) show = true;
        else if (prefMin > 0) show = txt.startsWith(q);
        else show = txt.includes(q);
        item.style.display = show ? "" : "none";
        if (show) visible++;
      });

      // A group header is shown only when at least one of its options survived
      // the filter, so searching never leaves dangling manufacturer labels.
      let header = null, headerHasVisible = false;
      const flush = () => { if (header) header.style.display = headerHasVisible ? "" : "none"; };
      children.forEach(item => {
        if (item.classList.contains("ss-group")){
          flush();
          header = item;
          headerHasVisible = false;
        } else if (item.style.display !== "none"){
          headerHasVisible = true;
        }
      });
      flush();

      // Helpful empty state: if the user has typed something but is below
      // the prefix threshold, hint at it instead of saying "no matches".
      if (q && prefMin > 0 && q.length < prefMin){
        this.empty.hidden = false;
        this.empty.textContent =
          (typeof t === "function" ? t("ss.typeMore") : "Type {n} characters to filter")
            .replace("{n}", prefMin);
      } else {
        this.empty.hidden = visible !== 0;
      }
    }

    onKey(e){
      const items = Array.from(this.list.children)
        .filter(i => i.style.display !== "none" && !i.classList.contains("ss-group"));
      if (!items.length) return;
      const cur = items.findIndex(i => i.classList.contains("hover"));
      const setHover = (idx) => {
        items.forEach(i => i.classList.remove("hover"));
        const target = items[(idx + items.length) % items.length];
        target.classList.add("hover");
        target.scrollIntoView({ block: "nearest" });
      };
      switch (e.keyCode) {
        case KEYS.DOWN: e.preventDefault(); setHover(cur < 0 ? 0 : cur + 1); break;
        case KEYS.UP:   e.preventDefault(); setHover(cur < 0 ? items.length-1 : cur - 1); break;
        case KEYS.ENTER:{
          e.preventDefault();
          const target = items[cur < 0 ? 0 : cur];
          if (target) this.choose(target.dataset.value);
          break;
        }
        case KEYS.ESC: e.preventDefault(); this.close(); break;
      }
    }
  }

  /* ---------- public API ---------- */
  function enhanceSelects(root = document){
    root.querySelectorAll("select:not([data-ss-skip]):not([data-ss-enhanced])").forEach(s => {
      s.dataset.ssEnhanced = "1";
      new SearchSelect(s);
    });
  }

  global.SearchSelect = SearchSelect;
  global.enhanceSelects = enhanceSelects;
})(window);
