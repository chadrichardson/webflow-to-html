// Parses and filters Webflow IX2 interaction data from webflow.js exports.

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

export function extractIX2Data(js) {
  if (!js || !js.trim()) throw new Error('Not a valid Webflow export');

  const initStart = js.indexOf('Webflow.require("ix2").init(');
  if (initStart === -1) return { events: {}, actionLists: {} };

  const rawStart = initStart + 'Webflow.require("ix2").init('.length;
  let depth = 0, dataEnd = -1;
  for (let i = rawStart; i < js.length; i++) {
    if (js[i] === "{") depth++;
    else if (js[i] === "}") { depth--; if (depth === 0) { dataEnd = i + 1; break; } }
  }
  if (dataEnd === -1) throw new Error("Could not find end of IX2 data");

  const dataStr = js.slice(rawStart, dataEnd);
  try {
    return eval("(" + dataStr + ")");
  } catch (e) {
    throw new Error("Failed to parse IX2 data: " + e.message);
  }
}

export function filterForPage(ix2Data, pageId, pageElementIds = new Set()) {
  const { events, actionLists } = ix2Data;
  const pageEvents = {};
  const usedActionListIds = new Set();

  for (const [eventId, event] of Object.entries(events || {})) {
    const targets = event.targets?.length ? event.targets : (event.target ? [event.target] : []);
    let matchesPage = false;

    for (const target of targets) {
      if (target.id && pageId && target.id.startsWith(pageId + "|")) { matchesPage = true; break; }
      if (target.id === pageId && target.appliesTo === "PAGE") { matchesPage = true; break; }
      const elementId = target.id?.includes("|") ? target.id.split("|")[1] : target.id;
      if (elementId && pageElementIds.has(elementId)) { matchesPage = true; break; }
    }

    if (matchesPage) {
      pageEvents[eventId] = event;
      const alId = event.action?.config?.actionListId;
      if (alId) usedActionListIds.add(alId);
    }
  }

  const pageActionLists = {};
  for (const alId of usedActionListIds) {
    if (actionLists[alId]) pageActionLists[alId] = actionLists[alId];
  }

  return { pageId, events: pageEvents, actionLists: pageActionLists };
}

export function buildIdMap(events, actionLists = {}) {
  const typeCounters = {};
  const elementToSlug = new Map();
  const eventToSlug = new Map();

  for (const [, event] of Object.entries(events || {})) {
    const targets = event.targets?.length ? event.targets : (event.target ? [event.target] : []);
    const type = typeFromEvent(event.eventTypeId);
    let eventSlug = null;

    for (const target of targets) {
      const elementId = target.id?.includes("|") ? target.id.split("|")[1] : target.id;
      if (elementId && elementToSlug.has(elementId)) { eventSlug = elementToSlug.get(elementId); break; }
    }

    for (const target of targets) {
      const elementId = target.id?.includes("|") ? target.id.split("|")[1] : target.id;
      if (!elementId) continue;
      if (!eventSlug) {
        typeCounters[type] = (typeCounters[type] || 0) + 1;
        eventSlug = `${type}-${typeCounters[type]}`;
      }
      if (!elementToSlug.has(elementId)) elementToSlug.set(elementId, eventSlug);
    }
  }

  let targetCounter = 0;
  const scanTarget = (tid) => {
    if (!tid) return;
    const elementId = tid.includes("|") ? tid.split("|")[1] : tid;
    if (!elementToSlug.has(elementId)) elementToSlug.set(elementId, `target-${++targetCounter}`);
  };

  for (const al of Object.values(actionLists || {})) {
    for (const group of al.actionItemGroups || [])
      for (const item of group.actionItems || []) scanTarget(item.config?.target?.id);
    for (const group of al.continuousParameterGroups || [])
      for (const cag of group.continuousActionGroups || [])
        for (const item of cag.actionItems || []) scanTarget(item.config?.target?.id);
  }

  for (const [eventId, event] of Object.entries(events || {})) {
    const targets = event.targets?.length ? event.targets : (event.target ? [event.target] : []);
    for (const target of targets) {
      const elementId = target.id?.includes("|") ? target.id.split("|")[1] : target.id;
      if (elementId && elementToSlug.has(elementId)) {
        eventToSlug.set(eventId, elementToSlug.get(elementId)); break;
      }
    }
  }

  return { elementToSlug, eventToSlug };
}
