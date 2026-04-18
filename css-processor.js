export const WF_BASE_CSS = `
* {
  box-sizing: border-box;
}

html {
  height: 100%;
}

body {
  margin: 0px;
  min-height: 100%;
  background-color: rgb(255, 255, 255);
  font-family: Arial, sans-serif;
  font-size: 14px;
  line-height: 20px;
  color: rgb(51, 51, 51);
}

img {
  max-width: 100%;
  vertical-align: middle;
  display: inline-block;
}

.w-inline-block {
  max-width: 100%;
  display: inline-block;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
  margin-bottom: 10px;
}

h2 {
  font-size: 32px;
  line-height: 36px;
  margin-top: 20px;
}

h3 {
  font-size: 24px;
  line-height: 30px;
  margin-top: 20px;
}

h4 {
  font-size: 18px;
  line-height: 24px;
  margin-top: 10px;
}

h5 {
  font-size: 14px;
  line-height: 20px;
  margin-top: 10px;
}

h6 {
  font-size: 12px;
  line-height: 18px;
  margin-top: 10px;
}

p {
  margin-top: 0px;
  margin-bottom: 10px;
}

.w-embed::before, .w-embed::after {
  content: " ";
  display: table;
  grid-area: 1 / 1 / 2 / 2;
}

.w-embed::after {
  clear: both;
}

.w-background-video {
  position: relative;
  overflow: hidden;
  height: 500px;
  color: white;
}

.w-background-video > video {
  background-size: cover;
  background-position: 50% 50%;
  position: absolute;
  margin: auto;
  width: 100%;
  height: 100%;
  inset: -100%;
  object-fit: cover;
  z-index: -100;
}

.w-background-video > video::-webkit-media-controls-start-playback-button {
  display: none !important;
  appearance: none;
}

.w-dropdown-list.w--open {
  display: block;
}

.w-dropdown-link.w--current {
  color: rgb(0, 130, 243);
}

.w-richtext::before, .w-richtext::after {
  content: " ";
  display: table;
  grid-area: 1 / 1 / 2 / 2;
}

.w-richtext::after {
  clear: both;
}

.w-nav-brand {
  position: relative;
  float: left;
  text-decoration: none;
  color: rgb(51, 51, 51);
}

.w-nav-link.w--current {
  color: rgb(0, 130, 243);
}

.w--nav-link-open {
  display: block;
  position: relative;
}

.w-nav-overlay {
  position: absolute;
  overflow: hidden;
  display: none;
  top: 100%;
  left: 0px;
  right: 0px;
  width: 100%;
}

.w-nav-overlay [data-nav-menu-open] {
  top: 0px;
}

.w-nav[data-animation="over-left"] .w-nav-overlay {
  width: auto;
}

.w-nav[data-animation="over-left"] .w-nav-overlay, .w-nav[data-animation="over-left"] [data-nav-menu-open] {
  right: auto;
  z-index: 1;
  top: 0px;
}

.w-nav[data-animation="over-right"] .w-nav-overlay {
  width: auto;
}

.w-nav[data-animation="over-right"] .w-nav-overlay, .w-nav[data-animation="over-right"] [data-nav-menu-open] {
  left: auto;
  z-index: 1;
  top: 0px;
}

.w-nav-button.w--open {
  background-color: rgb(200, 200, 200);
  color: white;
}

.w-tab-link.w--current {
  background-color: rgb(200, 200, 200);
}

.w--tab-active {
  display: block;
}

@media screen and (max-width: 767px) {
  .w-nav-brand {
    padding-left: 10px;
  }
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

const WF_DYNAMIC_SAFELIST = [
  "w--open", "w--current", "w--active", "w--tab-active",
  "w--redirected-to", "w--nav-menu-open", "w--nav-link-open",
  "w-nav-overlay", "w--is-active", "w-dropdown-toggle--open",
];

export function stripUnusedCss(cssText, htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, "text/html");
  const tempStyle = document.createElement("style");
  tempStyle.textContent = cssText;
  document.head.appendChild(tempStyle);

  try {
    const sheet = tempStyle.sheet;
    const stripped = [];

    function processRules(ruleList) {
      const output = [];
      for (const rule of ruleList) {
        if (rule instanceof CSSMediaRule) {
          const inner = processRules(rule.cssRules);
          if (inner.length > 0) output.push(`@media ${rule.conditionText} {\n${inner.join("\n")}\n}`);
          continue;
        }
        if (rule instanceof CSSKeyframesRule) { output.push(rule.cssText); continue; }
        if (rule instanceof CSSFontFaceRule) {
          if (rule.cssText.includes("webflow-icons")) continue;
          output.push(rule.cssText); continue;
        }
        if (!(rule instanceof CSSStyleRule)) { output.push(rule.cssText); continue; }

        const selectors = rule.selectorText.split(",").map(s => s.trim());
        let match = false;
        for (const sel of selectors) {
          if (WF_DYNAMIC_SAFELIST.some(cls => sel.includes(cls))) { match = true; break; }
          const baseSel = sel
            .replace(/::[ \w-]+(\([^)]*\))?/g, "")
            .replace(/:[ \w-]+(\([^)]*\))?/g, "")
            .trim();
          if (!baseSel) { match = true; break; }
          try {
            if (doc.querySelector(baseSel)) { match = true; break; }
          } catch { match = true; break; }
        }
        if (match) output.push(rule.cssText);
        else stripped.push(rule.selectorText);
      }
      return output;
    }

    const result = processRules(sheet.cssRules);
    return { css: result.join("\n\n"), strippedCount: stripped.length };
  } finally {
    document.head.removeChild(tempStyle);
  }
}

export function beautifyCss(css) {
  return css
    .replace(/\}\s*/g, "}\n\n")
    .replace(/\{(?!\n)/g, "{\n  ")
    .replace(/;\s*(?!\n)/g, ";\n  ")
    .replace(/\n  \}/g, "\n}")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
