const UPSTREAM_ORIGIN = (process.env.AIDEDD_ORIGIN || "https://www.aidedd.org").replace(/\/$/, "");
const BRIDGE_CHANNEL = "aidedd-map-table-bridge-v1";

const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function bridgeScript() {
  return `<script data-aidedd-map-bridge>(function(){
    "use strict";
    var CHANNEL=${JSON.stringify(BRIDGE_CHANNEL)};
    var activeMap=null;
    var pendingState=null;
    var emitTimer=null;
    var patchedLeaflet=false;

    function cleanState(raw){
      if(!raw||typeof raw!=="object") return null;
      var lat=Number(raw.lat),lng=Number(raw.lng),zoom=Number(raw.zoom);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(zoom)) return null;
      return {lat:lat,lng:lng,zoom:zoom,path:location.pathname+location.search+location.hash};
    }

    function post(type,payload){
      try{parent.postMessage(Object.assign({channel:CHANNEL,type:type},payload||{}),"*");}catch(_e){}
    }

    function looksLikeMap(value){
      return !!value
        && typeof value.getCenter==="function"
        && typeof value.getZoom==="function"
        && typeof value.setView==="function"
        && typeof value.on==="function";
    }

    function currentState(){
      if(!looksLikeMap(activeMap)) return null;
      try{
        var center=activeMap.getCenter();
        return cleanState({lat:center.lat,lng:center.lng,zoom:activeMap.getZoom()});
      }catch(_e){return null;}
    }

    function sendCurrentState(reason,requestId){
      var state=currentState();
      if(state) post("state",{state:state,reason:reason||"change",requestId:requestId||null});
    }

    function emitState(reason){
      clearTimeout(emitTimer);
      emitTimer=setTimeout(function(){sendCurrentState(reason||"change");},70);
    }

    function applyState(state){
      var clean=cleanState(state);
      if(!clean) return;
      pendingState=clean;
      if(!looksLikeMap(activeMap)) return;
      try{
        if(typeof activeMap.invalidateSize==="function") activeMap.invalidateSize({animate:false,pan:false});
        activeMap.setView([clean.lat,clean.lng],clean.zoom,{animate:false,reset:true});
        setTimeout(function(){sendCurrentState("applied");},90);
      }catch(_e){}
    }

    function attachMap(map){
      if(!looksLikeMap(map)) return null;
      if(map.__dmtAttached){activeMap=map;return map;}
      map.__dmtAttached=true;
      activeMap=map;
      try{map.on("move zoom moveend zoomend",function(){emitState("moveend");});}catch(_e){}
      post("ready",{mapFound:true});
      if(pendingState){
        applyState(pendingState);
        setTimeout(function(){if(pendingState) applyState(pendingState);},180);
        setTimeout(function(){if(pendingState) applyState(pendingState);},650);
      }
      setTimeout(function(){sendCurrentState("ready");},120);
      return map;
    }

    function scanForMap(){
      if(looksLikeMap(activeMap)) return activeMap;
      var preferred=["map","myMap","mymap","atlasMap","leafletMap"];
      for(var i=0;i<preferred.length;i++){
        try{if(looksLikeMap(window[preferred[i]])) return attachMap(window[preferred[i]]);}catch(_e){}
      }
      var keys=[];
      try{keys=Object.getOwnPropertyNames(window);}catch(_e){}
      for(var j=0;j<keys.length;j++){
        var value;
        try{value=window[keys[j]];}catch(_e){continue;}
        if(looksLikeMap(value)) return attachMap(value);
      }
      return null;
    }

    function patchLeaflet(L){
      if(!L||patchedLeaflet) return;
      patchedLeaflet=true;
      try{
        if(L.Map&&typeof L.Map.addInitHook==="function") L.Map.addInitHook(function(){attachMap(this);});
      }catch(_e){}
      try{
        if(typeof L.map==="function"&&!L.map.__dmtWrapped){
          var original=L.map;
          var wrapped=function(){return attachMap(original.apply(this,arguments));};
          Object.assign(wrapped,original);
          wrapped.__dmtWrapped=true;
          L.map=wrapped;
        }
      }catch(_e){}
      scanForMap();
    }

    try{
      var storedL=window.L;
      Object.defineProperty(window,"L",{
        configurable:true,
        enumerable:true,
        get:function(){return storedL;},
        set:function(value){storedL=value;patchLeaflet(value);}
      });
      if(storedL) patchLeaflet(storedL);
    }catch(_e){}

    var poll=setInterval(function(){
      try{patchLeaflet(window.L);scanForMap();}catch(_e){}
      if(activeMap) clearInterval(poll);
    },75);
    setTimeout(function(){clearInterval(poll);},30000);

    window.addEventListener("message",function(event){
      var data=event.data;
      if(!data||data.channel!==CHANNEL) return;
      if(data.type==="set-state") applyState(data.state);
      if(data.type==="request-state"){
        scanForMap();
        clearTimeout(emitTimer);
        sendCurrentState("requested",data.requestId);
      }
    });

    ["pushState","replaceState"].forEach(function(name){
      try{
        var original=history[name];
        history[name]=function(){
          var result=original.apply(this,arguments);
          setTimeout(function(){emitState("url");},0);
          return result;
        };
      }catch(_e){}
    });
    window.addEventListener("hashchange",function(){emitState("url");});
    window.addEventListener("popstate",function(){emitState("url");});
    window.addEventListener("load",function(){
      scanForMap();
      post("ready",{mapFound:!!activeMap});
      if(pendingState) setTimeout(function(){applyState(pendingState);},100);
    },{once:true});

    if(document.readyState==="loading"){
      document.addEventListener("DOMContentLoaded",function(){scanForMap();post("ready",{mapFound:!!activeMap});},{once:true});
    }else{
      scanForMap();
      post("ready",{mapFound:!!activeMap});
    }
  })();</script>`;
}

function rewriteText(text, bridgeOrigin, contentType) {
  let rewritten = text
    .replaceAll(`${UPSTREAM_ORIGIN}/`, `${bridgeOrigin}/`)
    .replaceAll(`//${new URL(UPSTREAM_ORIGIN).host}/`, `//${new URL(bridgeOrigin).host}/`);
  if (contentType.includes("text/html")) {
    const injection = bridgeScript();
    if (/<head[^>]*>/i.test(rewritten)) rewritten = rewritten.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
    else rewritten = `${injection}${rewritten}`;
  }
  return rewritten;
}

async function proxy(request, context) {
  const params = await context.params;
  const pathParts = Array.isArray(params?.path) ? params.path : [];
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`/${pathParts.map(encodeURIComponent).join("/")}`, `${UPSTREAM_ORIGIN}/`);
  upstreamUrl.search = requestUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  headers.set("accept-encoding", "identity");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store"
  };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();

  const upstream = await fetch(upstreamUrl, init);
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "x-frame-options" || lower === "content-security-policy") continue;
    responseHeaders.set(key, value);
  }

  const bridgeOrigin = requestUrl.origin;
  const location = upstream.headers.get("location");
  if (location) {
    try {
      const target = new URL(location, UPSTREAM_ORIGIN);
      if (target.origin === new URL(UPSTREAM_ORIGIN).origin) {
        responseHeaders.set("location", `${bridgeOrigin}${target.pathname}${target.search}${target.hash}`);
      }
    } catch (_error) {}
  }

  responseHeaders.set("content-security-policy", "frame-ancestors *");
  responseHeaders.set("referrer-policy", "strict-origin-when-cross-origin");

  if (request.method === "HEAD" || [204, 304].includes(upstream.status)) {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const isText = contentType.includes("text/html")
    || contentType.includes("text/css")
    || contentType.includes("javascript")
    || contentType.includes("application/json")
    || contentType.includes("text/plain");

  if (isText) {
    const text = await upstream.text();
    const rewritten = rewriteText(text, bridgeOrigin, contentType);
    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", contentType.includes("text/html") ? "no-store" : "public, max-age=3600");
    return new Response(rewritten, { status: upstream.status, headers: responseHeaders });
  }

  responseHeaders.set("cache-control", "public, max-age=86400");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, context) { return proxy(request, context); }
export async function HEAD(request, context) { return proxy(request, context); }
export async function POST(request, context) { return proxy(request, context); }
export async function PUT(request, context) { return proxy(request, context); }
export async function PATCH(request, context) { return proxy(request, context); }
export async function DELETE(request, context) { return proxy(request, context); }
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "*"
    }
  });
}
