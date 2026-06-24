// ============================================================================
// CAPA DE INFRAESTRUCTURA  ·  Utilidad de bajo nivel
// ----------------------------------------------------------------------------
// Parser XML mínimo y sin dependencias, afinado para las respuestas SOAP planas
// de los servicios .asmx de OASIS (ESPOCH). Maneja elementos anidados, hermanos
// repetidos (-> arreglos), texto, tags auto-cerrados y xsi:nil. Quita prefijos
// de namespace (soap:, xsi:, ...) de los nombres de elemento.
// ============================================================================

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function localName(name) {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

// Tokeniza en eventos open / close / text.
function tokenize(xml) {
  const tokens = [];
  let i = 0;
  const len = xml.length;
  while (i < len) {
    if (xml[i] === "<") {
      const end = xml.indexOf(">", i);
      if (end === -1) break;
      let tag = xml.slice(i + 1, end);
      i = end + 1;
      if (tag[0] === "?" || tag[0] === "!") continue; // declaración / comentario / doctype
      let selfClose = false;
      if (tag.endsWith("/")) {
        selfClose = true;
        tag = tag.slice(0, -1);
      }
      const closing = tag[0] === "/";
      if (closing) tag = tag.slice(1);
      const space = tag.search(/\s/);
      const rawName = space === -1 ? tag : tag.slice(0, space);
      const attrs = space === -1 ? "" : tag.slice(space);
      const name = localName(rawName.trim());
      if (!name) continue;
      if (closing) {
        tokens.push({ t: "close", name });
      } else {
        const nil = /\bnil\s*=\s*["']true["']/i.test(attrs);
        tokens.push({ t: "open", name, nil });
        if (selfClose) tokens.push({ t: "close", name });
      }
    } else {
      const next = xml.indexOf("<", i);
      const stop = next === -1 ? len : next;
      const text = xml.slice(i, stop);
      if (text.trim()) tokens.push({ t: "text", value: decodeEntities(text) });
      i = stop;
    }
  }
  return tokens;
}

function addChild(parent, name, node) {
  const existing = parent.children[name];
  if (existing === undefined) parent.children[name] = node;
  else if (Array.isArray(existing)) existing.push(node);
  else parent.children[name] = [existing, node];
}

function nodeToValue(node) {
  const keys = Object.keys(node.children);
  if (keys.length === 0) {
    if (node.nil) return null;
    return node.text;
  }
  const obj = {};
  for (const key of keys) {
    const value = node.children[key];
    obj[key] = Array.isArray(value) ? value.map(nodeToValue) : nodeToValue(value);
  }
  return obj;
}

export function parseXml(xml) {
  const tokens = tokenize(String(xml));
  const root = { name: "#root", children: {}, text: "", nil: false };
  const stack = [root];
  for (const tk of tokens) {
    const top = stack[stack.length - 1];
    if (tk.t === "open") {
      const node = { name: tk.name, children: {}, text: "", nil: tk.nil };
      addChild(top, tk.name, node);
      stack.push(node);
    } else if (tk.t === "close") {
      if (stack.length > 1) stack.pop();
    } else if (tk.t === "text") {
      top.text += tk.value;
    }
  }
  return nodeToValue(root);
}

// Siempre devuelve un arreglo para un nodo que puede venir como objeto, arreglo o ausente.
export function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
