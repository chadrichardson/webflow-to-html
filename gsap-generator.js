// Analyzes IX2 data for GSAP plugin requirements and generates GSAP 3 interaction code.

const GSAP_BUILTIN_RE = /^(none|linear|power[1-4]\.(in|out|inOut)|back\.(in|out|inOut)(\(\S+\))?|bounce\.(in|out|inOut)|elastic\.(in|out|inOut)(\(\S+,\s*\S+\))?|circ\.(in|out|inOut)|expo\.(in|out|inOut)|sine\.(in|out|inOut)|steps\(\d+\))$/;
const BUILTIN_PRESET_IDS = new Set(["slideInBottom", "slideInLeft", "slideInRight"]);

function typeFromEvent(eventTypeId) {
  switch (eventTypeId) {
    case "PAGE_START": case "PAGE_FINISH": return "load";
    case "SCROLL_INTO_VIEW": case "SCROLL_OUT_OF_VIEW": return "scroll";
    case "SCROLLING_IN_VIEW": return "scrub";
    case "MOUSE_CLICK": case "MOUSE_SECOND_CLICK": return "click";
    case "MOUSE_OVER": case "MOUSE_OUT": return "hover";
    default: return "ix";
  }
}

export function analyzePageData(pageData, doc = null) {
  const { events, actionLists } = pageData;
  let needsScrollTrigger = false, needsLottie = false;
  const customEaseNames = new Set();

  const checkEasing = (val) => {
    if (!val) return;
    const resolved = resolveEasing(val);
    if (!GSAP_BUILTIN_RE.test(resolved)) customEaseNames.add(val);
  };

  for (const event of Object.values(events || {})) {
    const et = event.eventTypeId;
    if (et === "SCROLL_INTO_VIEW" || et === "SCROLL_OUT_OF_VIEW" || et === "SCROLLING_IN_VIEW")
      needsScrollTrigger = true;
    checkEasing(event.action?.config?.easing);
  }

  for (const al of Object.values(actionLists || {})) {
    for (const group of al.actionItemGroups || []) {
      for (const item of group.actionItems || []) {
        checkEasing(item.config?.easing);
        if (item.actionTypeId === "PLUGIN_LOTTIE") needsLottie = true;
      }
    }
  }

  if (!needsLottie && doc) {
    if (doc.querySelector('[data-animation-type="lottie"]') ||
        doc.querySelector('[data-lottie]') ||
        doc.querySelector('[data-src*=".json"]')) {
      needsLottie = true;
    }
  }

  return { needsScrollTrigger, needsLottie, needsCustomEase: customEaseNames.size > 0, customEaseNames };
}

export function resolveEasing(easing) {
  const map = {
    ease: "power1.inOut", easeIn: "power1.in", easeOut: "power1.out", easeInOut: "power1.inOut",
    inOutCubic: "power3.inOut", inOutQuart: "power4.inOut", inOutQuint: "power4.inOut", inOutSine: "sine.inOut",
    outCubic: "power3.out", outQuart: "power4.out", outQuint: "power4.out", outSine: "sine.out",
    outBack: "back.out(1.7)", inCubic: "power3.in", inQuart: "power4.in", inSine: "sine.in",
    outBounce: "bounce.out", inBounce: "bounce.in", inOutBounce: "bounce.inOut",
    outElastic: "elastic.out(1, 0.3)", inElastic: "elastic.in(1, 0.3)", linear: "none",
  };
  return map[easing] ?? (easing || "none");
}

export function resolveActionTarget(target, triggerVar, idMap = {}) {
  if (!target) return null;
  const { id, selector, useEventTarget } = target;
  if (useEventTarget === true || useEventTarget === "TRIGGER_ELEMENT") return triggerVar;
  if (useEventTarget === "CHILDREN" && selector) {
    return triggerVar.startsWith("'") || triggerVar.startsWith('"')
      ? `'${triggerVar.slice(1, -1)} ${selector}'`
      : `${triggerVar}.querySelectorAll("${selector}")`;
  }
  if (useEventTarget === "SIBLINGS" && selector) {
    return triggerVar.startsWith("'") || triggerVar.startsWith('"')
      ? `"${selector}"`
      : `${triggerVar}.parentElement?.querySelectorAll("${selector}")`;
  }
  if (useEventTarget === "PARENTS" && selector) {
    return triggerVar.startsWith("'") || triggerVar.startsWith('"')
      ? `"${selector}"`
      : `${triggerVar}.closest("${selector}")`;
  }
  if (selector) return `"${selector}"`;
  if (id?.includes("|")) {
    const elementId = id.split("|")[1];
    const slug = idMap.elementToSlug?.get(elementId) || elementId;
    return `'[data-ix="${slug}"]'`;
  }
  return null;
}

export function buildGsapProps(actionTypeId, config, includeTiming) {
  const {
    duration = 0, delay = 0, easing = "",
    value, xValue, yValue, zValue,
    xUnit = "px", yUnit = "px", zUnit = "px",
    widthValue, heightValue, widthUnit, heightUnit,
  } = config || {};

  const props = {};
  switch (actionTypeId) {
    case "TRANSFORM_MOVE":
      if (xValue != null) props.x = `"${xValue}${xUnit}"`;
      if (yValue != null) props.y = `"${yValue}${yUnit}"`;
      break;
    case "TRANSFORM_SCALE":
      if (xValue != null) props.scaleX = xValue;
      if (yValue != null) props.scaleY = yValue;
      break;
    case "TRANSFORM_ROTATE":
      if (zValue != null) props.rotation = zValue;
      if (xValue != null) props.rotationX = xValue;
      if (yValue != null) props.rotationY = yValue;
      break;
    case "STYLE_OPACITY":
      props.opacity = value;
      break;
    case "STYLE_SIZE":
      if (widthUnit === "AUTO") props.width = '"auto"';
      else if (widthValue != null) props.width = `"${widthValue}${widthUnit || "px"}"`;
      if (heightUnit === "AUTO") { props.height = '"auto"'; props.overflow = '"hidden"'; }
      else if (heightValue != null) props.height = `"${heightValue}${heightUnit || "px"}"`;
      break;
    case "GENERAL_DISPLAY":
      props.display = `"${value}"`;
      break;
  }

  if (includeTiming) {
    props.duration = duration / 1000;
    if (easing) props.ease = `"${resolveEasing(easing)}"`;
  }

  return { props, dur: duration / 1000, del: delay / 1000 };
}

export function propsToString(props) {
  return Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(", ");
}

export function translateBuiltinPreset(presetId, triggerVar, indent, phase = "all") {
  const pad = " ".repeat(indent);
  const sets = {
    slideInBottom: `${pad}gsap.set(${triggerVar}, { opacity: 0, y: 100 });`,
    slideInLeft:   `${pad}gsap.set(${triggerVar}, { opacity: 0, x: -100 });`,
    slideInRight:  `${pad}gsap.set(${triggerVar}, { opacity: 0, x: 100 });`,
  };
  const anims = {
    slideInBottom: `${pad}gsap.to(${triggerVar}, { opacity: 1, y: 0, duration: 1, ease: "power4.out" });`,
    slideInLeft:   `${pad}gsap.to(${triggerVar}, { opacity: 1, x: 0, duration: 1, ease: "power4.out" });`,
    slideInRight:  `${pad}gsap.to(${triggerVar}, { opacity: 1, x: 0, duration: 1, ease: "power4.out" });`,
  };
  const fallback = `${pad}// MANUAL: Unknown preset "${presetId}"`;
  if (phase === "init") return sets[presetId] ? [sets[presetId]] : [];
  if (phase === "anim") return anims[presetId] ? [anims[presetId]] : [fallback];
  return [sets[presetId] ?? fallback, anims[presetId] ?? ''].filter(Boolean);
}

function actionListHasLottie(al) {
  if (!al) return false;
  for (const group of al.actionItemGroups || [])
    for (const item of group.actionItems || [])
      if (item.actionTypeId === "PLUGIN_LOTTIE") return true;
  return false;
}

export function translateActionList(al, triggerVar, indent, phase = "all", tlName = null, idMap = {}) {
  if (!al) return [];
  if (al._builtin) return translateBuiltinPreset(al.id, triggerVar, indent, phase);

  const pad = " ".repeat(indent);
  const lines = [];
  const { actionItemGroups = [], useFirstGroupAsInitialState = false, continuousParameterGroups } = al;

  if (continuousParameterGroups?.length) return lines;

  if (phase !== "anim" && useFirstGroupAsInitialState && actionItemGroups[0]) {
    for (const item of actionItemGroups[0].actionItems) {
      if (item.actionTypeId === "PLUGIN_SPLINE") continue;
      if (item.actionTypeId === "PLUGIN_LOTTIE") {
        const targetExpr = resolveActionTarget(item.config?.target, triggerVar, idMap);
        if (!targetExpr) continue;
        const val = item.config?.value ?? 0;
        lines.push(`${pad}gsap.utils.toArray(${targetExpr}).forEach(el => {`);
        lines.push(`${pad}  const _l = el._lottieAnim; if (!_l) return;`);
        lines.push(`${pad}  const _sf = () => _l.goToAndStop((${val} / 100) * Math.max(_l.totalFrames - 1, 1), true);`);
        lines.push(`${pad}  _l.totalFrames > 0 ? _sf() : _l.addEventListener("DOMLoaded", _sf);`);
        lines.push(`${pad}});`);
        continue;
      }
      const targetExpr = resolveActionTarget(item.config?.target, triggerVar, idMap);
      if (!targetExpr) continue;
      const { props } = buildGsapProps(item.actionTypeId, item.config, false);
      if (Object.keys(props).length > 0) lines.push(`${pad}gsap.set(${targetExpr}, { ${propsToString(props)} });`);
    }
  }

  if (phase === "init") return lines;

  const animGroups = useFirstGroupAsInitialState ? actionItemGroups.slice(1) : actionItemGroups;
  if (animGroups.length === 0) return lines;

  const tlVar = tlName || `tl_${al.id.replace(/-/g, "_")}_${String(triggerVar).replace(/[^a-zA-Z0-9]/g, "_").slice(0, 12)}`;
  if (!tlName) lines.push(`${pad}const ${tlVar} = gsap.timeline();`);

  let groupPos = 0;
  for (const group of animGroups) {
    let maxEnd = 0;
    for (const item of group.actionItems) {
      if (item.actionTypeId === "PLUGIN_SPLINE") {
        lines.push(`${pad}// MANUAL REQUIRED: PLUGIN_SPLINE — needs Spline API`);
        continue;
      }
      if (item.actionTypeId === "PLUGIN_LOTTIE") {
        const targetExpr = resolveActionTarget(item.config?.target, triggerVar, idMap);
        if (!targetExpr) continue;
        const val = item.config?.value ?? 0;
        const dur = ((item.config?.duration ?? 0) / 1000).toFixed(3);
        const del = ((item.config?.delay ?? 0) / 1000).toFixed(3);
        const ease = item.config?.easing ? `"${resolveEasing(item.config.easing)}"` : '"none"';
        const pos = (groupPos + parseFloat(del)).toFixed(3);
        lines.push(`${pad}gsap.utils.toArray(${targetExpr}).forEach(el => {`);
        lines.push(`${pad}  const _l = el._lottieAnim; if (!_l) return;`);
        lines.push(`${pad}  const _p = { v: _l.currentFrame / Math.max(_l.totalFrames - 1, 1) };`);
        lines.push(`${pad}  ${tlVar}.to(_p, { v: ${val / 100}, duration: ${dur}, ease: ${ease}, onUpdate: () => _l.goToAndStop(_p.v * Math.max(_l.totalFrames - 1, 1), true) }, ${pos});`);
        lines.push(`${pad}});`);
        maxEnd = Math.max(maxEnd, parseFloat(del) + parseFloat(dur));
        continue;
      }

      const targetExpr = resolveActionTarget(item.config?.target, triggerVar, idMap);
      if (!targetExpr) continue;

      if (item.actionTypeId === "GENERAL_DISPLAY") {
        const { props, del } = buildGsapProps(item.actionTypeId, item.config, false);
        lines.push(`${pad}${tlVar}.set(${targetExpr}, { ${propsToString(props)} }, ${(groupPos + del).toFixed(3)});`);
        maxEnd = Math.max(maxEnd, del);
        continue;
      }

      const { props, dur, del } = buildGsapProps(item.actionTypeId, item.config, true);
      if (Object.keys(props).length === 0) continue;
      lines.push(`${pad}${tlVar}.to(${targetExpr}, { ${propsToString(props)} }, ${(groupPos + del).toFixed(3)});`);
      maxEnd = Math.max(maxEnd, del + dur);
    }
    groupPos += maxEnd;
  }
  return lines;
}

export async function generateGsapScript(pageData, idMap = {}, analysis = {}) {
  const { events, actionLists } = pageData;
  const { needsScrollTrigger, needsLottie, needsCustomEase } = analysis;
  const lines = [];

  const plugins = [];
  if (needsScrollTrigger) plugins.push("ScrollTrigger");
  if (needsCustomEase) plugins.push("CustomEase");
  if (plugins.length > 0) lines.push(`gsap.registerPlugin(${plugins.join(", ")});`, "");

  if (needsLottie) {
    lines.push(
      "// LOTTIE INITIALIZATION",
      "(function initLottie() {",
      "  document.querySelectorAll('[data-lottie]').forEach(el => {",
      "    const src = el.dataset.src; if (!src) return;",
      "    el._lottieAnim = lottie.loadAnimation({ container: el, renderer: el.dataset.renderer || \"svg\", loop: el.dataset.loop === \"1\", autoplay: el.dataset.autoplay === \"1\", path: src });",
      "  });",
      "})();",
      ""
    );
  }

  const buckets = { pageLoad: [], scroll: [], click: [], scrolling: [], hover: [] };
  Object.entries(events || {}).forEach(([id, e]) => {
    const et = e.eventTypeId;
    if (["PAGE_START", "PAGE_FINISH"].includes(et)) buckets.pageLoad.push([id, e]);
    else if (["SCROLL_INTO_VIEW", "SCROLL_OUT_OF_VIEW"].includes(et)) buckets.scroll.push([id, e]);
    else if (["MOUSE_CLICK", "MOUSE_SECOND_CLICK", "NAVBAR_OPEN", "NAVBAR_CLOSE", "DROPDOWN_OPEN", "DROPDOWN_CLOSE"].includes(et)) buckets.click.push([id, e]);
    else if (["MOUSE_OVER", "MOUSE_OUT"].includes(et)) buckets.hover.push([id, e]);
    else if (et === "SCROLLING_IN_VIEW") buckets.scrolling.push([id, e]);
  });

  if (buckets.pageLoad.length > 0) {
    lines.push("// PAGE LOAD ANIMATIONS", 'window.addEventListener("load", () => {');
    buckets.pageLoad.forEach(([, e]) => {
      const al = actionLists[e.action?.config?.actionListId];
      if (al) translateActionList(al, "document.body", 2, "all", null, idMap).forEach(l => lines.push(l));
    });
    lines.push("});", "");
  }

  if (buckets.scroll.length > 0) {
    lines.push("// SCROLL INTO/OUT OF VIEW");
    const processed = new Set();
    buckets.scroll.forEach(([id, e]) => {
      if (processed.has(id)) return;
      processed.add(id);
      const alId = e.action?.config?.actionListId;
      const pairedId = e.action?.config?.autoStopEventId;
      if (pairedId) processed.add(pairedId);

      const target = e.targets?.[0] || e.target;
      const elementId = target?.id?.includes("|") ? target.id.split("|")[1] : null;
      if (!elementId) return;

      const slug = idMap.elementToSlug?.get(elementId) || elementId;
      const triggerSel = `'[data-ix="${slug}"]'`;
      const al = actionLists[alId];
      const isBuiltin = !al && BUILTIN_PRESET_IDS.has(alId);
      const scrollOffset = e.config?.scrollOffsetValue ?? 0;
      const scrollUnit = (e.config?.scrollOffsetUnit ?? "%").toUpperCase();
      const startPos = scrollOffset === 0 ? "top 100%"
        : scrollUnit === "PX" ? `top bottom-=${scrollOffset}` : `top ${100 - scrollOffset}%`;

      if (al) translateActionList(al, triggerSel, 0, "init", null, idMap).forEach(l => lines.push(l));
      else if (isBuiltin) translateBuiltinPreset(alId, triggerSel, 0, "init").forEach(l => lines.push(l));

      const hasPair = !!(pairedId && events[pairedId]);
      const loopEvent = e.config?.loop === true;
      const triggerDelay = (e.action?.config?.delay ?? 0) / 1000;

      if (hasPair) {
        const outAl = actionLists[events[pairedId]?.action?.config?.actionListId];
        lines.push(`ScrollTrigger.create({`, `  trigger: ${triggerSel},`, `  start: "${startPos}",`, `  end: "bottom top",`,
          `  onEnter: (self) => { const el = self.trigger; gsap.delayedCall(${triggerDelay}, () => {`);
        if (al) translateActionList(al, "el", 4, "anim", null, idMap).forEach(l => lines.push(l));
        else if (isBuiltin) translateBuiltinPreset(alId, "el", 4, "anim").forEach(l => lines.push(l));
        lines.push(`  }) },`, `  onLeave: (self) => { const el = self.trigger;`);
        if (outAl) translateActionList(outAl, "el", 4, "anim", null, idMap).forEach(l => lines.push(l));
        lines.push(`  },`, `  onEnterBack: (self) => { const el = self.trigger; gsap.delayedCall(${triggerDelay}, () => {`);
        if (al) translateActionList(al, "el", 4, "anim", null, idMap).forEach(l => lines.push(l));
        lines.push(`  }) },`, `  onLeaveBack: (self) => { const el = self.trigger;`);
        if (outAl) translateActionList(outAl, "el", 4, "anim", null, idMap).forEach(l => lines.push(l));
        lines.push(`  }`, `});`);
      } else {
        lines.push(`ScrollTrigger.create({`, `  trigger: ${triggerSel},`, `  start: "${startPos}",`,
          loopEvent ? "" : `  once: true,`,
          `  onEnter: (self) => { const el = self.trigger; gsap.delayedCall(${triggerDelay}, () => {`);
        if (al) translateActionList(al, "el", 4, "anim", null, idMap).forEach(l => lines.push(l));
        else if (isBuiltin) translateBuiltinPreset(alId, "el", 4, "anim").forEach(l => lines.push(l));
        lines.push(`  }) }`, `});`);
      }
    });
    lines.push("");
  }

  if (buckets.scrolling.length > 0) {
    lines.push("// SCROLL PROGRESS");
    buckets.scrolling.forEach(([, e]) => {
      const alId = e.action?.config?.actionListId;
      const al = actionLists[alId];
      const target = e.targets?.[0] || e.target;
      const elementId = target?.id?.includes("|") ? target.id.split("|")[1] : null;
      if (!elementId || !al?.continuousParameterGroups) return;
      const slug = idMap.elementToSlug?.get(elementId) || elementId;
      const triggerSel = `'[data-ix="${slug}"]'`;
      const smoothing = Array.isArray(e.config) ? (e.config[0]?.smoothing ?? 0) : 0;
      const scrub = smoothing > 0 ? (smoothing / 100).toFixed(2) : "true";
      const varId = slug.replace(/-/g, "_");

      al.continuousParameterGroups.forEach(group => {
        const frames = [...(group.continuousActionGroups || [])].sort((a, b) => a.keyframe - b.keyframe);
        if (frames.length < 2) return;
        lines.push(`const tl_${varId} = gsap.timeline({ paused: true });`);
        const fromFrame = frames[0], toFrame = frames[frames.length - 1];
        for (let i = 0; i < fromFrame.actionItems.length; i++) {
          const fromItem = fromFrame.actionItems[i], toItem = toFrame.actionItems[i];
          if (!toItem) continue;
          const targetExpr = resolveActionTarget(fromItem.config?.target, triggerSel, idMap);
          if (!targetExpr) continue;
          const { props: fP } = buildGsapProps(fromItem.actionTypeId, fromItem.config, false);
          const { props: tP } = buildGsapProps(toItem.actionTypeId, toItem.config, false);
          if (Object.keys(fP).length === 0 && Object.keys(tP).length === 0) continue;
          const tPStr = propsToString(tP);
          const toObj = tPStr ? `{ ${tPStr}, ease: "none" }` : `{ ease: "none" }`;
          lines.push(`tl_${varId}.fromTo(${targetExpr}, { ${propsToString(fP)} }, ${toObj});`);
        }
        lines.push(`ScrollTrigger.create({ trigger: ${triggerSel}, start: "top bottom", end: "bottom top", scrub: ${scrub}, animation: tl_${varId} });`);
      });
    });
    lines.push("");
  }

  if (buckets.click.length > 0) {
    lines.push("// CLICK INTERACTIONS");
    const processed = new Set();
    buckets.click.forEach(([id, e]) => {
      if (processed.has(id)) return;
      processed.add(id);
      const alId = e.action?.config?.actionListId;
      const pairedId = e.action?.config?.autoStopEventId;
      if (pairedId) processed.add(pairedId);
      const target = e.targets?.[0] || e.target;
      const rawId = target?.id;
      const elementId = rawId?.includes("|") ? rawId.split("|")[1] : rawId;
      const selector = target?.selector;
      const slug = elementId ? (idMap.elementToSlug?.get(elementId) || elementId) : null;
      const triggerSel = selector || (slug ? `[data-ix="${slug}"]` : null);
      if (!triggerSel) return;
      const al = actionLists[alId];
      const outAl = pairedId && events[pairedId] ? actionLists[events[pairedId]?.action?.config?.actionListId] : null;
      const varId = (slug || id).replace(/-/g, "_");

      const hasLottie = actionListHasLottie(al) || actionListHasLottie(outAl);
      lines.push(`document.querySelectorAll('${triggerSel}').forEach(el => {`);
      if (hasLottie) {
        // Lottie timelines must be built at click time so currentFrame is current
        if (outAl) {
          lines.push(`  let _on = false;`);
          lines.push(`  el.addEventListener("click", () => {`);
          lines.push(`    const tl_${varId} = gsap.timeline();`);
          if (al) translateActionList(al, "el", 4, "all", `tl_${varId}`, idMap).forEach(l => lines.push(l));
          lines.push(`    const tl_${varId}_out = gsap.timeline();`);
          translateActionList(outAl, "el", 4, "all", `tl_${varId}_out`, idMap).forEach(l => lines.push(l));
          lines.push(`    _on ? tl_${varId}_out.play() : tl_${varId}.play(); _on = !_on;`);
          lines.push(`  });`);
        } else if (al) {
          lines.push(`  el.addEventListener("click", () => {`);
          lines.push(`    const tl_${varId} = gsap.timeline();`);
          translateActionList(al, "el", 4, "all", `tl_${varId}`, idMap).forEach(l => lines.push(l));
          lines.push(`  });`);
        }
      } else {
        if (al) {
          lines.push(`  const tl_${varId} = gsap.timeline({ paused: true });`);
          translateActionList(al, "el", 2, "all", `tl_${varId}`, idMap).forEach(l => lines.push(l));
        }
        if (outAl) {
          lines.push(`  const tl_${varId}_out = gsap.timeline({ paused: true });`);
          translateActionList(outAl, "el", 2, "all", `tl_${varId}_out`, idMap).forEach(l => lines.push(l));
          lines.push(`  let _on = false; el.addEventListener("click", () => { _on ? tl_${varId}_out.restart() : tl_${varId}.restart(); _on = !_on; });`);
        } else {
          lines.push(`  el.addEventListener("click", () => { tl_${varId}.restart(); });`);
        }
      }
      lines.push(`});`);
    });
    lines.push("");
  }

  if (buckets.hover.length > 0) {
    lines.push("// HOVER INTERACTIONS");
    const processed = new Set();
    buckets.hover.forEach(([id, e]) => {
      if (processed.has(id) || e.eventTypeId !== "MOUSE_OVER") return;
      processed.add(id);
      const alId = e.action?.config?.actionListId;
      const pairedId = e.action?.config?.autoStopEventId;
      if (pairedId) processed.add(pairedId);
      const target = e.targets?.[0] || e.target;
      const rawId = target?.id;
      const elementId = rawId?.includes("|") ? rawId.split("|")[1] : rawId;
      const selector = target?.selector;
      const slug = elementId ? (idMap.elementToSlug?.get(elementId) || elementId) : null;
      const triggerSel = selector || (slug ? `[data-ix="${slug}"]` : null);
      if (!triggerSel) return;
      const al = actionLists[alId];
      const outAl = pairedId && events[pairedId] ? actionLists[events[pairedId]?.action?.config?.actionListId] : null;
      const varId = (slug || id).replace(/-/g, "_");

      lines.push(`document.querySelectorAll('${triggerSel}').forEach(el => {`);
      if (al) {
        lines.push(`  const tl_${varId}_over = gsap.timeline({ paused: true });`);
        translateActionList(al, "el", 2, "all", `tl_${varId}_over`, idMap).forEach(l => lines.push(l));
      }
      if (outAl) {
        lines.push(`  const tl_${varId}_out = gsap.timeline({ paused: true });`);
        translateActionList(outAl, "el", 2, "all", `tl_${varId}_out`, idMap).forEach(l => lines.push(l));
      }
      if (al && outAl)
        lines.push(`  el.addEventListener("mouseenter", () => { tl_${varId}_out.pause(); tl_${varId}_over.restart(); }); el.addEventListener("mouseleave", () => { tl_${varId}_over.pause(); tl_${varId}_out.restart(); });`);
      else if (al)
        lines.push(`  el.addEventListener("mouseenter", () => { tl_${varId}_over.restart(); });`);
      else if (outAl)
        lines.push(`  el.addEventListener("mouseleave", () => { tl_${varId}_out.restart(); });`);
      lines.push(`});`);
    });
    lines.push("");
  }

  let jsString = lines.join("\n");

  let customEaseFailed = false;
  if (needsCustomEase) {
    try {
      const resp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/CustomEase.min.js');
      if (resp.ok) {
        jsString = `// CustomEase inlined\n${await resp.text()}\n\n${jsString}`;
      } else {
        customEaseFailed = true;
      }
    } catch {
      customEaseFailed = true;
    }
  }

  return { js: jsString, customEaseFailed };
}
