/* E-Paper site kit: <script src="https://HOST/embed.js" data-paper="slug" data-edition="latest"></script>
   Optional: data-reader (reader base URL), data-target (selector), data-max-width. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var base = s.getAttribute("data-reader") || new URL(".", s.src).href;
  var paper = s.getAttribute("data-paper") || "";
  var edition = s.getAttribute("data-edition") || "latest";
  var sel = s.getAttribute("data-target");
  var host = (sel && document.querySelector(sel)) || document.querySelector("div[data-epaper]");
  if (!host) { host = document.createElement("div"); s.parentNode.insertBefore(host, s); }
  var f = document.createElement("iframe");
  var q = "?embed=1" + (paper ? "&paper=" + encodeURIComponent(paper) : "");
  f.src = base + q + "#/" + encodeURIComponent(edition) + "/1";
  f.title = "E-Paper";
  f.loading = "lazy";
  f.setAttribute("data-epaper-frame", "");
  f.style.cssText = "width:100%;max-width:" + (s.getAttribute("data-max-width") || "560px") + ";height:480px;border:0;display:block;margin:0 auto";
  host.appendChild(f);
  var origin = new URL(base, location.href).origin;
  addEventListener("message", function (e) {
    if (e.source !== f.contentWindow || e.origin !== origin) return;
    var d = e.data || {};
    if (d.type === "epaper:height" && d.height > 0) f.style.height = Math.ceil(d.height) + "px";
    if (d.type === "epaper:open" && typeof d.url === "string" && d.url.indexOf(origin) === 0) { var w = window.open(d.url, "_blank"); if (w) w.opener = null; else location.href = d.url; }
  });
})();
