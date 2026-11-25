// ==UserScript==
// @name         Exporter Canonical Elite Website — Menu + Etapas + Shadow DOM
// @namespace    https://aeliteestrangeira.com/tools
// @version      3.2.0
// @description  Exportação ZIP em 7 etapas, iniciada apenas pelo menu do Violentmonkey. Sem painel, botão ou overlay no site.
// @author       A Elite Estrangeira
// @match        *://*/*
// @run-at       document-start
// @inject-into  auto
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

/*
 * EXPORTER CANONICAL ELITE WEBSITE v3.2.0
 * Não envia backups a servidores de terceiros. O ZIP é gerado no navegador.
 * Shadow CLOSED: capturado se attachShadow foi interceptado ANTES da criação,
 * ou se o navegador expuser serialização via getHTML({serializableShadowRoots:true}).
 * Shadow CLOSED anterior à instrumentação e não serializável é inacessível.
 * Iniciar via ícone do Violentmonkey → nome do script → Iniciar exportação ZIP.
 * O script não adiciona controles visuais ao site. O progresso aparece no console.
 */
(() => {
  'use strict';
  if (window !== window.top) return;

  // Comando nativo do Violentmonkey: aparece abaixo do nome do script no popup.
  // Registrado desde document-start, sem criar painel ou botão na página.
  let startExport = null;
  try {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('Iniciar exportação ZIP', () => {
        if (startExport) void startExport();
        else console.error('[Canonical Elite] Inicialização incompleta nesta aba. Recarregue a página.');
      }, {
        id: 'canonical-start-export',
        title: 'Exportar a página atual em ZIP (7 etapas)',
        autoClose: true
      });
    } else {
      console.warn('[Canonical Elite] GM_registerMenuCommand indisponível. Confirme as permissões do Violentmonkey.');
    }
  } catch (error) {
    console.error('[Canonical Elite] Falha ao registrar o comando de exportação:', error);
  }

  if (window.__canonicalEliteV32Loaded) return;
  try {
    Object.defineProperty(window, '__canonicalEliteV32Loaded', {value: true, configurable: true});
  } catch (error) {
    console.error('[Canonical Elite] Falha na inicialização:', error);
    return;
  }

  const CFG = Object.freeze({
    maxScrollContainers: 7, scrollSteps: 175, scrollPause: 115,
    settleChecks: 7, settlePause: 260, extraSweep: true,
    concurrency: 5, timeout: 25000, maxResources: 1600,
    maxResourceBytes: 42 * 1024 * 1024, maxTotalBytes: 480 * 1024 * 1024,
    maxScripts: 160, maxScriptBytes: 9 * 1024 * 1024,
    mediaDir: 'assets/media', cssPath: 'assets/site.css'
  });
  const enc = new TextEncoder(), dec = new TextDecoder();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ROOTS = new WeakMap();
  const app = {running: false, cancelled: false};
  const STAGES = ['Varrer e estabilizar', 'Capturar DOM e Shadow DOM', 'Arquivar scripts',
    'Consolidar folhas CSS', 'Reescrever recursos para caminhos locais', 'Baixar arquivos', 'Gerar ZIP'];
  const failStop = () => { if (app.cancelled) throw new Error('Exportação cancelada.'); };
  function progress(msg) {
    console.info('[Canonical Elite v3.2]', msg);
  }
  function slug(s) {return (String(s || 'resource').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,90) || 'resource');}
  function hash(s) {let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
  function urlOf(raw, base=document.baseURI) {
    if (!raw || /^(?:data:|javascript:|mailto:|tel:|#|about:|file:)/i.test(String(raw).trim())) return null;
    try {const u=new URL(String(raw).trim(),base); u.hash=''; return /^(?:https?:|blob:)/i.test(u.protocol) ? u.href : null;} catch{return null;}
  }
  function where(el) {let a=[], n=el; for(let i=0;n&&n.nodeType===1&&i<6;i++,n=n.parentElement){a.unshift(n.localName+(n.id?'#'+n.id:''));if(n.id)break;}return a.join(' > ')||'(shadow root)';}
  const attrs = el => Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]));
  const extFromMime = type => ({'image/svg+xml':'.svg','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/avif':'.avif','image/gif':'.gif','image/x-icon':'.ico','font/woff2':'.woff2','font/woff':'.woff','font/ttf':'.ttf','font/otf':'.otf','audio/mpeg':'.mp3','audio/ogg':'.ogg','video/mp4':'.mp4','video/webm':'.webm','application/pdf':'.pdf'}[String(type).split(';')[0].toLowerCase()]||'.bin');
  function fileName(u) {let x='resource';try{x=decodeURIComponent(new URL(u).pathname.split('/').pop()||'resource');}catch{}x=slug(x);if(!/\.[a-z\d]{1,10}$/i.test(x))x+=extFromMime('');const dot=x.lastIndexOf('.');return `${x.slice(0,dot).slice(0,65)}--${hash(u)}${x.slice(dot)}`;}

  // Executado no contexto da página desde document-start, para guardar a referência
  // retornada por attachShadow(). Não altera 'mode' e não expõe roots no DOM.
  try {
    const nativeAttach = Element.prototype.attachShadow;
    if (typeof nativeAttach === 'function') {
      Element.prototype.attachShadow = function (options) {
        const root = Reflect.apply(nativeAttach, this, [options]);
        if (root) ROOTS.set(this, root);
        return root;
      };
    }
  } catch (err) {console.warn('[Canonical Elite] Interceptação de attachShadow indisponível',err);}
  function getShadow(host) {try {return host.shadowRoot || ROOTS.get(host) || null;}catch{return null;}}

  // Percorre elementos inclusive raízes abertas/fechadas já capturadas e aninhadas.
  function* liveElements(start) {
    const stack=[start], seen=new Set();
    while(stack.length){
      const node=stack.pop(); if(!node||seen.has(node))continue; seen.add(node);
      if(node.nodeType===1){
        yield node;
        const sr=getShadow(node); if(sr)stack.push(sr);
        if(node.localName==='template'&&node.content)stack.push(node.content);
      }
      if(node.childNodes)for(let i=node.childNodes.length-1;i>=0;i--)stack.push(node.childNodes[i]);
    }
  }
  function* outputElements(start) {
    const stack=[start], seen=new Set();
    while(stack.length){
      const n=stack.pop();if(!n||seen.has(n))continue;seen.add(n);
      if(n.nodeType===1){yield n;if(n.localName==='template'&&n.content)stack.push(n.content);}
      if(n.childNodes)for(let i=n.childNodes.length-1;i>=0;i--)stack.push(n.childNodes[i]);
    }
  }
  // Uma única serialização global evita chamar getHTML em cada elemento (O(n²)).
  // Permite recuperar raízes CLOSED com opção serializable, inclusive em <div>.
  function serializedClosedMap() {
    const found=new WeakMap();
    if(typeof document.documentElement?.getHTML!=='function')return found;
    try {
      const html=document.documentElement.getHTML({serializableShadowRoots:true});
      if(!/shadowrootmode\s*=\s*["']?closed/i.test(html))return found;
      const wrapper=document.createElement('html');wrapper.innerHTML=html;
      const walk=(actual,serialized)=>{
        if(actual.nodeType===1&&serialized.nodeType===1){
          if(!getShadow(actual)){
            const candidate=[...serialized.children].find(e=>e.localName==='template'&&e.getAttribute('shadowrootmode')==='closed');
            if(candidate)found.set(actual,candidate);
          }
        }
        const a=[...actual.childNodes];
        const b=[...serialized.childNodes].filter(n=>!(n.nodeType===1&&n.localName==='template'&&n.hasAttribute('shadowrootmode')));
        for(let i=0;i<Math.min(a.length,b.length);i++)walk(a[i],b[i]);
        if(actual.nodeType===1&&actual.localName==='template'&&serialized.localName==='template'){
          const x=[...actual.content.childNodes],y=[...serialized.content.childNodes];
          for(let i=0;i<Math.min(x.length,y.length);i++)walk(x[i],y[i]);
        }
      };
      walk(document.documentElement,wrapper);
    } catch(e){console.warn('[Canonical Elite] Shadow serializável indisponível:',e);}
    return found;
  }

  const CRC_TABLE=new Uint32Array(256);
  for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);CRC_TABLE[i]=c>>>0;}
  function crc32(a){let c=0xffffffff;for(const b of a)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function toBytes(v){if(typeof v==='string')return enc.encode(v);if(v instanceof Uint8Array)return v;if(v instanceof ArrayBuffer)return new Uint8Array(v);throw Error('Bytes não suportados');}
  class ZipStore {
    constructor(){this.chunks=[];this.directory=[];this.offset=0;this.count=0;this.paths=new Set();}
    add(path,content){
      if(this.paths.has(path))throw Error('Arquivo ZIP duplicado: '+path);
      this.paths.add(path);const name=enc.encode(path), data=toBytes(content), crc=crc32(data);
      if(this.count>=65535||this.offset+data.length>0xffffffff)throw Error('Limite ZIP32 excedido.');
      const a=new Uint8Array(30+name.length),av=new DataView(a.buffer);
      av.setUint32(0,0x04034b50,true);av.setUint16(4,20,true);av.setUint16(6,0x800,true);av.setUint32(14,crc,true);av.setUint32(18,data.length,true);av.setUint32(22,data.length,true);av.setUint16(26,name.length,true);a.set(name,30);
      const b=new Uint8Array(46+name.length),bv=new DataView(b.buffer);
      bv.setUint32(0,0x02014b50,true);bv.setUint16(4,20,true);bv.setUint16(6,20,true);bv.setUint16(8,0x800,true);bv.setUint32(16,crc,true);bv.setUint32(20,data.length,true);bv.setUint32(24,data.length,true);bv.setUint16(28,name.length,true);bv.setUint32(42,this.offset,true);b.set(name,46);
      this.chunks.push(a,data);this.directory.push(b);this.offset+=a.length+data.length;this.count++;
    }
    blob(){const end=new Uint8Array(22),dv=new DataView(end.buffer),total=this.directory.reduce((a,b)=>a+b.length,0);if(this.offset+total>0xffffffff)throw Error('Limite ZIP32 excedido.');dv.setUint32(0,0x06054b50,true);dv.setUint16(8,this.count,true);dv.setUint16(10,this.count,true);dv.setUint32(12,total,true);dv.setUint32(16,this.offset,true);return new Blob([...this.chunks,...this.directory,end],{type:'application/zip'});}
  }
  async function bytesFor(url) {
    failStop();
    let gmError='';
    try {
      if(typeof GM_xmlhttpRequest==='function')return await new Promise((resolve,reject)=>{
        GM_xmlhttpRequest({method:'GET',url,responseType:'arraybuffer',timeout:CFG.timeout,
          onload(r){if(r.status<200||r.status>=300)return reject(Error('HTTP '+r.status));if(!(r.response instanceof ArrayBuffer))return reject(Error('Resposta binária vazia'));const m=String(r.responseHeaders||'').match(/^content-type:\s*([^\r\n]+)/im);resolve({body:new Uint8Array(r.response),mime:m?m[1]:''});},
          onerror:()=>reject(Error('Erro de rede')),ontimeout:()=>reject(Error('Tempo limite')),onabort:()=>reject(Error('Abortado'))});
      });
    } catch(e){gmError=String(e.message||e);}
    const r=await fetch(url,{credentials:'include',cache:'force-cache'});
    if(!r.ok)throw Error(`${gmError}; Fetch HTTP ${r.status}`);
    return {body:new Uint8Array(await r.arrayBuffer()),mime:r.headers.get('content-type')||''};
  }
  async function textFor(url){return dec.decode((await bytesFor(url)).body);}
  async function parallel(list,worker,limit=CFG.concurrency){let n=0;await Promise.all(Array.from({length:Math.min(limit,list.length)},async()=>{while(n<list.length){const i=n++;failStop();await worker(list[i],i);}}));}
  async function replaceAllAsync(text,re,fn){let start=0,s='';for(const m of text.matchAll(re)){s+=text.slice(start,m.index)+await fn(m);start=m.index+m[0].length;}return s+text.slice(start);}
  const CSS_URL=/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
  const CSS_IMPORT=/@import\s+(?:url\(\s*)?(['"]?)([^'"\s);]+)\1\s*\)?\s*([^;]*);/gi;
  class BackupJob {
    constructor(){this.zip=new ZipStore();this.assets=new Map();this.total=0;this.docClone=null;this.pairs=[];this.shadow=[];this.manifest={
      exporter:'Exporter Canonical Elite Website',version:'3.2.0',createdAt:new Date().toISOString(),
      sourceURL:location.href,sourceBase:document.baseURI,title:document.title,
      scan:[],shadows:[],removedScripts:[],removedEvents:[],removedEmbeds:[],cssSources:[],resources:[],warnings:[],failures:[],
      limitations:['Backup da página atual, não crawler de domínio','JS desativado na cópia','Shadow closed só quando a raiz foi registrada cedo ou é serializável','CSS do Shadow mantido no próprio shadow root por encapsulamento']};}
    register(raw,base,kind){const url=urlOf(raw,base);if(!url)return null;let a=this.assets.get(url);if(a)return a;if(this.assets.size>=CFG.maxResources){this.manifest.failures.push({url,kind,error:'Limite de recursos'});return null;}a={url,path:CFG.mediaDir+'/'+fileName(url),kind,status:'pending'};this.assets.set(url,a);return a;}
    scanContainers(){
      const root=document.scrollingElement||document.documentElement, found=[];
      for(const el of liveElements(document.documentElement)){
        if(el===root)continue;
        try{const s=getComputedStyle(el);if(el.clientHeight<180||el.scrollHeight<el.clientHeight+150||!/^(auto|scroll|overlay)$/.test(s.overflowY))continue;found.push({el,score:el.scrollHeight*Math.max(1,Math.min(1600,el.clientWidth))});}catch{}
      }
      found.sort((a,b)=>b.score-a.score);const out=[root];for(const {el} of found){if(out.length>=CFG.maxScrollContainers)break;if(out.some(p=>p!==root&&p.contains?.(el)))continue;out.push(el);}return out;
    }
    async settle(){let prev='',same=0;for(let i=0;i<CFG.settleChecks;i++){failStop();await wait(CFG.settlePause);let n=0;for(const el of liveElements(document.documentElement))n++;const x=`${n}|${document.scrollingElement?.scrollHeight}|${performance.getEntriesByType('resource').length}`;same=x===prev?same+1:0;prev=x;if(same>=2)break;}}
    async endScroll(el,side,name){
      for(let i=0;i<CFG.scrollSteps;i++){failStop();const max=Math.max(0,el.scrollHeight-el.clientHeight),pos=Math.max(0,el.scrollTop),target=side==='top'?0:max;if(Math.abs(target-pos)<4)break;const stride=Math.max(260,Math.floor(el.clientHeight*.82));el.scrollTop=side==='top'?Math.max(0,pos-stride):Math.min(max,pos+stride);progress(`Etapa 1/7: ${name} ${side==='top'?'↑':'↓'} ${Math.round(100*el.scrollTop/(max||1))}%`);await wait(CFG.scrollPause);}await this.settle();
    }
    async scanPage(){
      const list=this.scanContainers(),prior=list.map(el=>({el,pos:el.scrollTop}));
      try{for(let i=0;i<list.length;i++){
        const el=list[i],max=Math.max(0,el.scrollHeight-el.clientHeight);if(max<10)continue;
        const near=el.scrollTop<max/2?'top':'bottom',far=near==='top'?'bottom':'top',label=`contêiner ${i+1}/${list.length}`;
        await this.endScroll(el,near,label);const before=el.scrollHeight;
        await this.endScroll(el,far,label);await this.endScroll(el,near,label);
        if(CFG.extraSweep&&before!==el.scrollHeight){await this.endScroll(el,far,label);await this.endScroll(el,near,label);}
        this.manifest.scan.push({container:where(el),nearFirst:near,scrollHeightBefore:before,scrollHeightAfter:el.scrollHeight});
      }
      await Promise.race([document.fonts?.ready||Promise.resolve(),wait(4500)]);await this.settle();
      }finally{for(const p of prior)try{p.el.scrollTop=p.pos;}catch{}}
    }
    cloneAndPair(){
      const cloneDoc=document.implementation.createHTMLDocument('');
      const copy=cloneDoc.importNode(document.documentElement,true);this.docClone=copy;
      const preexistingClosed=serializedClosedMap();
      const pair=(original,copied,inShadow=false)=>{
        if(original.nodeType===1&&copied.nodeType===1){
          this.pairs.push({src:original,dst:copied,inShadow});
          const root=getShadow(original);
          if(root){
            const template=cloneDoc.createElement('template');template.setAttribute('shadowrootmode',root.mode);
            if(root.delegatesFocus)template.setAttribute('shadowrootdelegatesfocus','');
            if(root.clonable)template.setAttribute('shadowrootclonable','');
            if(root.serializable)template.setAttribute('shadowrootserializable','');
            const children=[...root.childNodes].map(n=>cloneDoc.importNode(n,true));
            for(const n of children)template.content.appendChild(n);
            const originalChildren=[...root.childNodes];
            for(let i=0;i<originalChildren.length;i++)pair(originalChildren[i],children[i],true);
            copied.insertBefore(template,copied.firstChild);
            this.shadow.push({root,template,host:original});
            this.manifest.shadows.push({host:where(original),mode:root.mode,source:'attachShadow/shadowRoot',children:root.childNodes.length});
          } else if(!original.shadowRoot&&original.localName!=='template'){
            const fallback=preexistingClosed.get(original);
            if(fallback){copied.insertBefore(cloneDoc.importNode(fallback,true),copied.firstChild);
              this.manifest.shadows.push({host:where(original),mode:'closed',source:'serializable-getHTML',note:'Cópia serializada sem acesso direto à raiz'});}
          }
        }
        // Capture os pares da árvore de luz original sem incluir templates injetados.
        const oChildren=[...original.childNodes];
        const cChildren=[...copied.childNodes].filter(n=>!(n.nodeType===1&&n.localName==='template'&&n.hasAttribute('shadowrootmode')));
        for(let i=0;i<Math.min(oChildren.length,cChildren.length);i++)pair(oChildren[i],cChildren[i],inShadow);
        // Conteúdo de <template> comum precisa de cópia e limpeza separada.
        if(original.nodeType===1&&original.localName==='template'&&copied.localName==='template'){
          const a=[...original.content.childNodes],b=[...copied.content.childNodes];
          for(let i=0;i<Math.min(a.length,b.length);i++)pair(a[i],b[i],inShadow);
        }
      };
      pair(document.documentElement,copy,false);
      this.sanitizeClone();
    }
    sanitizeClone(){
      const m=this.manifest;
      for(const {src,dst,inShadow} of this.pairs){
        if(dst.nodeType!==1)continue;
        if(src.localName==='img'){
          const chosen=src.currentSrc||src.getAttribute('data-src')||src.getAttribute('src');if(chosen&&urlOf(chosen))dst.setAttribute('src',chosen);
        }
        if(src.localName==='input'){
          const privateInput=src.type==='password'||/pass|token|secret|otp|api[-_]?key|auth|one-time-code/i.test([src.name,src.id,src.autocomplete].join(' '));
          dst.value=privateInput?'':src.value;dst.setAttribute('value',privateInput?'':src.value);
          if(src.checked)dst.setAttribute('checked','');else dst.removeAttribute('checked');
          if(privateInput)m.warnings.push('Campo privado apagado: '+where(src));
        } else if(src.localName==='textarea'){dst.textContent=src.value;}
        else if(src.localName==='select'){for(let i=0;i<dst.options.length;i++){if(src.options[i]?.selected)dst.options[i].setAttribute('selected','');else dst.options[i].removeAttribute('selected');}}
        if(src.localName==='canvas'){
          try{const img=dst.ownerDocument.createElement('img');img.src=src.toDataURL('image/png');img.width=src.width;img.height=src.height;dst.replaceWith(img);}catch{m.warnings.push('Canvas protegido não exportado: '+where(src));}
        }
        for(const a of [...dst.attributes]){
          if(/^on[a-z]+$/i.test(a.name)||(/^(href|src|action|formaction|xlink:href)$/i.test(a.name)&&/^\s*javascript:/i.test(a.value))){
            m.removedEvents.push({where:where(src),attribute:a.name,originalValue:a.value});dst.removeAttribute(a.name);
          }
        }
        if(/^(script|noscript)$/i.test(src.localName)){dst.remove();continue;}
        if(/^(iframe|frame|object|embed)$/i.test(src.localName)){
          m.removedEmbeds.push({where:where(src),tag:src.localName,attributes:attrs(src)});
          // Omite o embed sem criar caixas, textos ou espaços de substituição.
          dst.remove();continue;
        }
        if(src.localName==='form'){if(dst.hasAttribute('action'))dst.setAttribute('data-original-action',dst.getAttribute('action'));dst.removeAttribute('action');}
        if(src.localName==='base'||(src.localName==='meta'&&/^(refresh|content-security-policy)$/i.test(src.getAttribute('http-equiv')||''))){dst.remove();continue;}
        if(src.localName==='link'){
          const rel=src.getAttribute('rel')||'';
          if(/\b(preconnect|dns-prefetch|modulepreload|prefetch)\b/i.test(rel)||(/\bpreload\b/i.test(rel)&&/script/i.test(src.getAttribute('as')||''))){dst.remove();continue;}
          if(!inShadow&&/\bstylesheet\b/i.test(rel)){dst.remove();continue;}
        }
        if(!inShadow&&src.localName==='style'){dst.remove();continue;}
      }
      // Remove conteúdo executável também de templates recebidos pelo fallback
      // getHTML(): essas raízes não aparecem em this.pairs.
      let unpaired=0;
      for(const el of [...outputElements(this.docClone)]){
        if(el.localName==='script'){
          const path=`archive/scripts/serialized-shadow-${String(++unpaired).padStart(4,'0')}.txt`;
          this.zip.add(path,el.textContent||'');
          m.removedScripts.push({type:'serialized-shadow',where:where(el),attributes:attrs(el),inlineArchive:path,externalURL:el.getAttribute('src')||null});
          el.remove();continue;
        }
        if(el.localName==='noscript'){el.remove();continue;}
        for(const a of [...el.attributes])if(/^on[a-z]+$/i.test(a.name)||(/^(href|src|action|formaction|xlink:href)$/i.test(a.name)&&/^\s*javascript:/i.test(a.value))){
          m.removedEvents.push({where:where(el),attribute:a.name,originalValue:a.value});el.removeAttribute(a.name);
        }
        if(/^(iframe|frame|object|embed)$/i.test(el.localName)){
          if(!el.parentNode)continue;
          m.removedEmbeds.push({where:where(el),tag:el.localName,attributes:attrs(el),source:'serialized-shadow'});
          // Fallback de Shadow DOM: também não emite mensagem visível.
          el.remove();
        }
        if(el.localName==='form')el.removeAttribute('action');
        if(el.localName==='base'||(el.localName==='meta'&&/^(refresh|content-security-policy)$/i.test(el.getAttribute('http-equiv')||'')))el.remove();
      }
      let head=copyHead(this.docClone);
      const link=head.ownerDocument.createElement('link');link.rel='stylesheet';link.href=CFG.cssPath;head.appendChild(link);
      if(!head.querySelector('meta[charset]')){const meta=head.ownerDocument.createElement('meta');meta.setAttribute('charset','utf-8');head.prepend(meta);}
    }
    async archiveScripts(){
      const originals=[...liveElements(document.documentElement)].filter(e=>e.localName==='script');
      const external=[];
      originals.forEach((el,i)=>{
        const index=i+1,item={index,where:where(el),attributes:attrs(el),type:el.type||'text/javascript',externalURL:el.src||null,inlineArchive:null,externalArchive:null};
        if(el.textContent){item.inlineArchive=`archive/scripts/inline-${String(index).padStart(4,'0')}.txt`;this.zip.add(item.inlineArchive,el.textContent);}
        if(item.externalURL)external.push(item);
        this.manifest.removedScripts.push(item);
      });
      await parallel(external.slice(0,CFG.maxScripts),async(entry,i)=>{
        progress(`Etapa 3/7: arquivando JS ${i+1}/${Math.min(external.length,CFG.maxScripts)}`);
        try{const out=await bytesFor(entry.externalURL);
          if(out.body.length>CFG.maxScriptBytes||this.total+out.body.length>CFG.maxTotalBytes)throw Error('Limite de bytes JS');
          entry.externalArchive=`archive/scripts/external-${String(entry.index).padStart(4,'0')}--${hash(entry.externalURL)}.js`;
          this.zip.add(entry.externalArchive,out.body);this.total+=out.body.length;
        }catch(err){this.manifest.failures.push({url:entry.externalURL,kind:'script-archive',error:String(err.message||err)});}
      });
      if(external.length>CFG.maxScripts)this.manifest.warnings.push('Scripts além do limite: '+(external.length-CFG.maxScripts));
    }
    async rewriteCSS(text,base,assetPrefix='media/',depth=0,stack=new Set()){
      if(depth>12){this.manifest.warnings.push('Limite @import CSS: '+base);return '';}
      text=String(text||'').replace(/^\s*@charset\s+['"][^'"]+['"];\s*/i,'').replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g,'');
      text=await replaceAllAsync(text,CSS_IMPORT,async m=>{
        const target=urlOf(m[2],base);if(!target||stack.has(target))return '/* @import circular ou inválido */';
        try{const child=await textFor(target);const next=new Set(stack);next.add(target);const css=await this.rewriteCSS(child,target,assetPrefix,depth+1,next);
          this.manifest.cssSources.push({source:target,kind:'@import',chars:child.length});
          const cond=(m[3]||'').trim();if(/\b(?:layer|supports)\b/i.test(cond)){this.manifest.warnings.push('@import moderno não reproduzido perfeitamente: '+m[0]);return `/* ${m[0].replace(/\*\//g,'* /')} */\n${css}`;}
          return cond?`@media ${cond} {\n${css}\n}`:css;
        }catch(err){this.manifest.failures.push({url:target,kind:'CSS import',error:String(err.message||err)});return `/* @import indisponível: ${target} */`;}
      });
      return replaceAllAsync(text,CSS_URL,async m=>{const raw=(m[1]??m[2]??m[3]??'').trim(),a=this.register(raw,base,'css-url');let frag='';try{frag=new URL(raw,base).hash;}catch{}return a?`url("${assetPrefix}${a.path.split('/').pop()}${frag}")`:m[0];});
    }
    async buildSheet(node,scopeLabel,assetPrefix){
      const kind=node.localName,base=kind==='style'?document.baseURI:(urlOf(node.getAttribute('href'),document.baseURI)||document.baseURI);
      if(node.disabled)return '';
      let raw='';
      if(kind==='style')raw=node.textContent||'';
      else{const u=urlOf(node.getAttribute('href'),document.baseURI);if(!u)return '';try{raw=await textFor(u);}catch(err){
        try{raw=[...node.sheet.cssRules].map(x=>x.cssText).join('\n');this.manifest.warnings.push('CSS CSSOM fallback: '+u);}catch{this.manifest.failures.push({url:u,kind:'stylesheet',error:String(err.message||err)});return '';}
      }}
      const css=await this.rewriteCSS(raw,base,assetPrefix,0,new Set([base]));
      const media=node.getAttribute('media')||'';
      this.manifest.cssSources.push({source:kind==='style'?where(node):base,scope:scopeLabel,chars:raw.length,media:media||'all'});
      return media&&media!=='all'?`@media ${media} {\n${css}\n}`:css;
    }
    async buildStyles(){
      const parts=['/* CANONICAL ELITE — CSS GLOBAL CONSOLIDADO */'];
      const globalSheets=[...document.querySelectorAll('style,link[rel~="stylesheet" i]')];
      for(let i=0;i<globalSheets.length;i++){
        failStop();progress(`Etapa 4/7: CSS global ${i+1}/${globalSheets.length}`);
        const node=globalSheets[i],raw=await this.buildSheet(node,'document','media/');
        if(raw)parts.push(`/* source: ${where(node)} */\n${raw}`);
      }
      for(const sheet of document.adoptedStyleSheets||[]){
        try{const raw=[...sheet.cssRules].map(r=>r.cssText).join('\n');parts.push(await this.rewriteCSS(raw,document.baseURI,'media/'));this.manifest.cssSources.push({source:'document.adoptedStyleSheets',scope:'document',chars:raw.length});}catch(err){this.manifest.warnings.push('adoptedStyleSheets global: '+err.message);}
      }
      // Não injeta CSS para placeholders: conteúdos incorporados são omitidos.
      this.zip.add(CFG.cssPath,parts.join('\n\n'));
      // CSS encapsulado de Shadow DOM DEVE ficar dentro de cada raiz. Um único CSS
      // global não atravessa os limites de shadow: mantemos UM arquivo CSS externo
      // e tags <style> locais consolidadas por shadow root.
      for(let i=0;i<this.shadow.length;i++){
        failStop();const {root,template,host}=this.shadow[i];
        progress(`Etapa 4/7: Shadow CSS ${i+1}/${this.shadow.length}`);
        const scoped=[];
        for(const el of root.querySelectorAll('style,link[rel~="stylesheet" i]')){
          // A consulta não atravessa roots aninhados; cada root tem seu processamento.
          const css=await this.buildSheet(el,'shadow:'+where(host),'assets/media/');if(css)scoped.push(css);
        }
        for(const sheet of root.adoptedStyleSheets||[]){
          try{const raw=[...sheet.cssRules].map(r=>r.cssText).join('\n');scoped.push(await this.rewriteCSS(raw,document.baseURI,'assets/media/'));this.manifest.cssSources.push({source:'adoptedStyleSheets',scope:'shadow:'+where(host),chars:raw.length});}catch(err){this.manifest.warnings.push('Shadow adoptedStyleSheets: '+err.message);}
        }
        for(const el of [...template.content.querySelectorAll('style,link[rel~="stylesheet" i]')])el.remove();
        if(scoped.length){const style=template.ownerDocument.createElement('style');style.setAttribute('data-canonical-shadow-css','');style.textContent=scoped.join('\n\n');template.content.insertBefore(style,template.content.firstChild);}
      }
      // Se houve serialização fallback de closed sem acesso à raiz, conservar CSS
      // presente no template, ajustando referências relativas no mesmo local.
      for(const el of outputElements(this.docClone))if(el.localName==='template'&&el.hasAttribute('shadowrootmode')&&!this.shadow.some(s=>s.template===el)){
        const scoped=[];
        const sheets=[...el.content.querySelectorAll('style,link[rel~="stylesheet" i]')];
        for(const node of sheets){const css=await this.buildSheet(node,'serialized-shadow','assets/media/');if(css)scoped.push(css);node.remove();}
        if(scoped.length){const style=el.ownerDocument.createElement('style');style.setAttribute('data-canonical-shadow-css','');style.textContent=scoped.join('\n\n');el.content.prepend(style);}
        this.manifest.warnings.push('Shadow serializado por fallback: adoptedStyleSheets inacessíveis não podem ser capturadas.');
      }
    }
    async rewriteSrcset(value,base){
      if(/data:/i.test(value))return value;
      return (await Promise.all(value.split(/,(?![^()]*\))/).map(async p=>{const match=p.trim().match(/^(\S+)(\s+.*)?$/);if(!match)return p;const a=this.register(match[1],base,'srcset');return(a?a.path:match[1])+(match[2]||'');}))).join(', ');
    }
    async rewriteHTML(){
      for(const el of outputElements(this.docClone)){
        failStop();if(!el.attributes)continue;
        const tag=el.localName,work=[];
        if(tag==='img'||tag==='source'){
          work.push('src');if(!el.hasAttribute('src'))for(const name of ['data-src','data-original','data-lazy-src']){if(el.hasAttribute(name)){el.setAttribute('src',el.getAttribute(name));break;}}
          if(!el.hasAttribute('srcset')&&el.hasAttribute('data-srcset'))el.setAttribute('srcset',el.getAttribute('data-srcset'));
        }
        if(tag==='video'||tag==='audio')work.push('src','poster');
        if(tag==='track')work.push('src');
        if(['image','use','feimage'].includes(tag))work.push('href','xlink:href');
        if(tag==='input'&&el.type==='image')work.push('src');
        if(tag==='link'&&/\b(icon|apple-touch-icon|mask-icon|preload)\b/i.test(el.getAttribute('rel')||''))work.push('href');
        if(tag==='meta'&&['og:image','twitter:image'].includes(el.getAttribute('property')))work.push('content');
        if(el.hasAttribute('background'))work.push('background');
        for(const attr of work){const raw=el.getAttribute(attr);if(!raw)continue;const a=this.register(raw,document.baseURI,`${tag}[${attr}]`);if(a){let frag='';try{frag=new URL(raw,document.baseURI).hash;}catch{}el.setAttribute(attr,a.path+frag);}}
        if(el.hasAttribute('srcset'))el.setAttribute('srcset',await this.rewriteSrcset(el.getAttribute('srcset'),document.baseURI));
        if(el.hasAttribute('imagesrcset'))el.setAttribute('imagesrcset',await this.rewriteSrcset(el.getAttribute('imagesrcset'),document.baseURI));
        if(el.hasAttribute('style'))el.setAttribute('style',await replaceAllAsync(el.getAttribute('style'),CSS_URL,async m=>{
          const raw=(m[1]??m[2]??m[3]??'').trim(),a=this.register(raw,document.baseURI,'inline-style');let frag='';try{frag=new URL(raw,document.baseURI).hash;}catch{}return a?`url("${a.path}${frag}")`:m[0];
        }));
        if(tag==='a'&&el.hasAttribute('href')){const raw=el.getAttribute('href');if(!/^(#|mailto:|tel:|javascript:|data:)/i.test(raw))try{el.setAttribute('href',new URL(raw,document.baseURI).href);}catch{}}
      }
    }
    async downloadAssets(){
      const items=[...this.assets.values()];
      await parallel(items,async(a,i)=>{
        progress(`Etapa 6/7: arquivo ${i+1}/${items.length}`);
        try{const out=await bytesFor(a.url);if(out.body.length>CFG.maxResourceBytes||this.total+out.body.length>CFG.maxTotalBytes)throw Error('Limite de tamanho');
          this.zip.add(a.path,out.body);a.status='saved';a.bytes=out.body.length;a.mime=out.mime;this.total+=out.body.length;
        }catch(err){a.status='failed';a.error=String(err.message||err);this.manifest.failures.push({url:a.url,kind:a.kind,error:a.error});}
      });
      this.manifest.resources=items.map(({url,path,kind,status,bytes,mime,error})=>({url,path,kind,status,bytes,mime,error}));
    }
    async finish(){
      const d=document.doctype,doctype=d?`<!DOCTYPE ${d.name}${d.publicId?` PUBLIC "${d.publicId}"`:''}${d.systemId?` "${d.systemId}"`:''}>`:'<!DOCTYPE html>';
      this.zip.add('index.html',doctype+'\n'+this.docClone.outerHTML);
      try{this.zip.add('archive/network-urls.json',JSON.stringify(performance.getEntriesByType('resource').map(x=>({url:x.name,initiator:x.initiatorType})),null,2));}catch{this.zip.add('archive/network-urls.json','[]');}
      this.zip.add('archive/manifest.json',JSON.stringify(this.manifest,null,2));
      this.zip.add('README.txt',`EXPORTER CANONICAL ELITE WEBSITE v3.2.0\n\nPágina: ${location.href}\nData: ${this.manifest.createdAt}\n\nindex.html: HTML renderizado e Shadow DOM declarativo\nassets/site.css: CSS global consolidado\nassets/media/: mídia, SVG, imagens, fontes e outros recursos\narchive/scripts/: fontes originais retiradas do HTML, não executadas\narchive/manifest.json: CSS original, scripts, Shadow DOM, falhas, recursos\n\nNOTA: shadow roots possuem estilos encapsulados dentro do próprio template para manter a aparência.\nAbra index.html num navegador moderno. Para problemas com fontes/file:// use servidor local.\nA cópia é ESTÁTICA: interações JS, login, APIs e iframes não são reproduzidos.\nShadow closed só é capturado quando instrumentado antes da criação ou serializável.\nAtenção: o backup pode conter dados privados que estavam na página.\n`);
      failStop();const blob=this.zip.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=u;a.download=`canonical-elite-${slug(location.hostname)}-${new Date().toISOString().replace(/[:.]/g,'-')}.zip`;
      a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);
      progress(`ZIP salvo em Downloads — ${this.manifest.resources.filter(x=>x.status==='saved').length} recursos; ${this.manifest.failures.length} falhas.`);
    }
  }
  function copyHead(root){let head=root.querySelector('head');if(!head){head=root.ownerDocument.createElement('head');root.prepend(head);}return head;}
  const METHODS=[j=>j.scanPage(),j=>j.cloneAndPair(),j=>j.archiveScripts(),j=>j.buildStyles(),j=>j.rewriteHTML(),j=>j.downloadAssets(),j=>j.finish()];
  async function runAll() {
    if (app.running) {
      progress('Já existe uma exportação em andamento nesta aba.');
      return;
    }
    app.running = true;
    app.cancelled = false;
    const job = new BackupJob();
    try {
      for (let step = 0; step < METHODS.length; step++) {
        failStop();
        progress(`Etapa ${step + 1}/${METHODS.length}: ${STAGES[step]}`);
        await METHODS[step](job);
      }
    } catch (err) {
      console.error('[Canonical Elite] Exportação interrompida:', err);
      progress('Falha na exportação: ' + String(err.message || err));
    } finally {
      app.running = false;
    }
  }

  // O único ponto de entrada da exportação é o comando no popup da extensão.
  // Nenhum modal, launcher, overlay, MutationObserver de UI ou botão flutuante.
  startExport = runAll;
  console.info('[Canonical Elite v3.2] Abra o Violentmonkey e clique em "Iniciar exportação ZIP" sob o nome do script.');
})();
